import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import archiver from "archiver";
import unzipper from "unzipper";
import sharp from "sharp";
import { sqlite } from "@/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { AppError, errorMessage } from "@/lib/errors";
import { archiveEntryForReference, storedCoverPath } from "@/features/covers/service";

const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 50_000;

function localReferences(ownerId: number): string[] {
  const rows = sqlite.prepare(`
    SELECT cover FROM books WHERE owner_id = ? AND cover IS NOT NULL
    UNION
    SELECT bv.cover FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ? AND bv.cover IS NOT NULL
  `).all(ownerId, ownerId) as Array<{ cover: string }>;
  return [...new Set(rows.map((row) => row.cover).filter((value) => value.startsWith("/covers/") || value.startsWith("cover://")))];
}

function archiveName(reference: string): string | null {
  return archiveEntryForReference(reference);
}

export function createCoverArchive(ownerId: number): PassThrough {
  const output = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  const references = localReferences(ownerId);
  const manifest: Array<{ reference: string; entry: string }> = [];
  const archivedEntries = new Set<string>();
  for (const reference of references) {
    const source = storedCoverPath(reference);
    const entry = archiveName(reference);
    if (!source || !entry || archivedEntries.has(entry) || !fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    archivedEntries.add(entry);
    archive.file(source, { name: entry });
    manifest.push({ reference, entry });
  }
  archive.append(JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), files: manifest }, null, 2), { name: "manifest.json" });
  void archive.finalize();
  return output;
}

function targetForReference(reference: string): string | null {
  return storedCoverPath(reference);
}

type ZipEntry = Readable & AsyncIterable<Buffer> & { path: string; type: string; autodrain(): void };

async function consumeEntry(entry: ZipEntry, collect: boolean): Promise<{ size: number; buffer: Buffer | null }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of entry) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > MAX_ENTRY_BYTES) {
      entry.autodrain();
      throw new AppError("ZIP 안의 개별 파일은 25MB 이하여야 합니다.");
    }
    if (collect) chunks.push(buffer);
  }
  return { size, buffer: collect ? Buffer.concat(chunks) : null };
}

function referenceMap(ownerId: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const reference of localReferences(ownerId)) {
    const entry = archiveName(reference);
    if (entry && !map.has(entry)) map.set(entry, reference);
  }
  return map;
}

function synchronizeCoverGenerated(ownerId: number): void {
  const updateBook = sqlite.prepare("UPDATE books SET cover_generated = ? WHERE owner_id = ? AND cover = ?");
  const updateVolume = sqlite.prepare(`
    UPDATE book_volumes SET cover_generated = ?
    WHERE cover = ? AND book IN (SELECT id FROM books WHERE owner_id = ?)
  `);
  for (const reference of localReferences(ownerId)) {
    const target = storedCoverPath(reference);
    const exists = target != null && fs.existsSync(target) && fs.statSync(target).isFile();
    updateBook.run(exists ? 1 : 0, ownerId, reference);
    updateVolume.run(exists ? 1 : 0, reference, ownerId);
  }
}

export function recoverInterruptedCoverArchiveJobs(): void {
  sqlite.prepare(`
    UPDATE backup_upload_job SET status = 'FAILED', lock_token = NULL,
      message = '워커 재기동으로 표지 복원 작업이 중단되었습니다. ZIP을 다시 업로드해 주세요.',
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'PROCESSING'
  `).run();
  sqlite.prepare(`
    UPDATE backup_upload_job SET status = 'FAILED', lock_token = NULL,
      message = '웹 프로세스 중단으로 ZIP 조립이 완료되지 않았습니다. 다시 업로드해 주세요.',
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'ASSEMBLING' AND updated_at < datetime('now', '-15 minutes')
  `).run();
}

export async function processNextCoverArchiveJob(): Promise<boolean> {
  const lockToken = randomUUID();
  const claim = sqlite.prepare(`
    UPDATE backup_upload_job SET status = 'PROCESSING', lock_token = ?,
      message = '표지 ZIP을 검사하고 있습니다.', updated_at = CURRENT_TIMESTAMP
    WHERE upload_id = (
      SELECT upload_id FROM backup_upload_job WHERE status = 'QUEUED' ORDER BY created_at LIMIT 1
    ) AND status = 'QUEUED'
  `).run(lockToken);
  if (claim.changes !== 1) return false;
  const job = sqlite.prepare(`
    SELECT upload_id AS uploadId, owner_id AS ownerId FROM backup_upload_job WHERE lock_token = ?
  `).get(lockToken) as { uploadId: string; ownerId: number };
  const archivePath = path.join(env.uploadsDir, job.uploadId, "archive.zip");
  let restored = 0, skipped = 0, count = 0, expandedBytes = 0;
  try {
    const allowed = referenceMap(job.ownerId);
    const parser = fs.createReadStream(archivePath).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of parser) {
      count += 1;
      if (count > MAX_ENTRIES) throw new AppError("ZIP 항목 수가 제한을 초과했습니다.");
      const normalized = path.posix.normalize(entry.path).replace(/^\.\//, "");
      if (entry.type !== "File") {
        entry.autodrain();
        continue;
      }
      const reference = normalized === "manifest.json" ? null : allowed.get(normalized);
      const target = reference ? targetForReference(reference) : null;
      const shouldRestore = Boolean(reference && target && !fs.existsSync(target));
      const consumed = await consumeEntry(entry as ZipEntry, shouldRestore);
      expandedBytes += consumed.size;
      if (expandedBytes > MAX_EXPANDED_BYTES) throw new AppError("ZIP 압축 해제 크기가 2GiB를 초과합니다.");
      if (!shouldRestore || !target || !consumed.buffer) {
        if (normalized !== "manifest.json") skipped += 1;
        continue;
      }
      const buffer = consumed.buffer;
      const metadata = await sharp(buffer, { animated: true, limitInputPixels: 40_000_000 }).metadata();
      if (!metadata.format || !["jpeg", "png", "gif", "webp"].includes(metadata.format)) {
        skipped += 1;
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer, { flag: "wx" });
      restored += 1;
      sqlite.prepare("UPDATE backup_upload_job SET message = ?, updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?")
        .run(`표지를 복원 중입니다. ${restored}개 복원`, job.uploadId);
    }

    const transaction = sqlite.transaction(() => {
      synchronizeCoverGenerated(job.ownerId);
      sqlite.prepare(`
        UPDATE backup_upload_job SET status = 'COMPLETED', lock_token = NULL,
          message = ?, updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?
      `).run(`표지 ${restored}개 복원, ${skipped}개 건너뜀`, job.uploadId);
    });
    transaction.immediate();
    fs.rmSync(path.join(env.uploadsDir, job.uploadId), { recursive: true, force: true });
  } catch (error) {
    sqlite.prepare(`
      UPDATE backup_upload_job SET status = 'FAILED', lock_token = NULL,
        message = ?, updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?
    `).run(`표지 복원 실패: ${errorMessage(error, "내부 오류가 발생했습니다. 서버 로그를 확인해 주세요.")}`, job.uploadId);
    logger.error("Cover archive restore failed", { uploadId: job.uploadId, error: String(error) });
  }
  return true;
}
