import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import archiver from "archiver";
import unzipper from "unzipper";
import sharp from "sharp";
import { sqlite } from "@/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { AppError, errorMessage } from "@/lib/errors";
import { archiveEntryForReference, normalizeImportedCoverReference, storedCoverPath } from "@/features/covers/service";
import { discardFailedCoverUploadFiles } from "@/features/backup/upload-cleanup";

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
  const sources: Array<{ source: string; entry: string }> = [];
  for (const reference of references) {
    const source = storedCoverPath(reference);
    const entry = archiveName(reference);
    if (!source || !entry || archivedEntries.has(entry) || !fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    archivedEntries.add(entry);
    sources.push({ source, entry });
    manifest.push({ reference, entry });
  }
  archive.append(JSON.stringify({ version: 3, generatedAt: new Date().toISOString(), files: manifest }, null, 2), { name: "manifest.json" });
  for (const { source, entry } of sources) archive.file(source, { name: entry });
  void archive.finalize();
  return output;
}

function targetForReference(reference: string): string | null {
  return storedCoverPath(reference);
}

type ZipEntry = AsyncIterable<Buffer> & { path: string; type: string };

async function consumeEntry(entry: ZipEntry, collect: boolean): Promise<{ size: number; buffer: Buffer | null }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of entry) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > MAX_ENTRY_BYTES) {
      throw new AppError("ZIP 안의 개별 파일은 25MB 이하여야 합니다.");
    }
    if (collect) chunks.push(buffer);
  }
  return { size, buffer: collect ? Buffer.concat(chunks) : null };
}

function referenceMap(ownerId: number): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const reference of localReferences(ownerId)) {
    const entry = archiveEntryForReference(reference, 2);
    if (!entry || ambiguous.has(entry)) continue;
    if (map.has(entry)) { map.delete(entry); ambiguous.add(entry); }
    else map.set(entry, reference);
  }
  return map;
}

async function validCover(target: string | null): Promise<boolean> {
  if (!target) return false;
  try {
    if (!fs.statSync(target).isFile()) return false;
    const decoder = sharp(target, { animated: true, limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!metadata.format || !["jpeg", "png", "gif", "webp"].includes(metadata.format)) return false;
    await decoder.stats();
    return true;
  } catch { return false; }
}

async function coverGeneratedState(ownerId: number): Promise<Map<string, boolean>> {
  const state = new Map<string, boolean>();
  for (const reference of localReferences(ownerId)) state.set(reference, await validCover(storedCoverPath(reference)));
  return state;
}

function synchronizeCoverGenerated(ownerId: number, state: Map<string, boolean>): void {
  const updateBook = sqlite.prepare("UPDATE books SET cover_generated = ? WHERE owner_id = ? AND cover = ?");
  const updateVolume = sqlite.prepare(`
    UPDATE book_volumes SET cover_generated = ?
    WHERE cover = ? AND book IN (SELECT id FROM books WHERE owner_id = ?)
  `);
  for (const [reference, exists] of state) {
    updateBook.run(exists ? 1 : 0, ownerId, reference);
    updateVolume.run(exists ? 1 : 0, reference, ownerId);
  }
}

async function publishCover(target: string, buffer: Buffer): Promise<boolean> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.restore.tmp`;
  try {
    fs.writeFileSync(temp, buffer, { flag: "wx" });
    // Decode the stored bytes before exposing them as the final cover.
    if (!(await validCover(temp))) throw new AppError("복원한 표지 이미지가 손상되었습니다.");
    // With one restore worker per DB, remove a pre-existing invalid target only.
    // Recheck after decoding: a concurrent regeneration may have published a good file.
    if (await validCover(target)) return false;
    if (fs.existsSync(target)) fs.rmSync(target);
    try { fs.linkSync(temp, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" && await validCover(target)) return false;
      throw error;
    }
    return true;
  } finally { fs.rmSync(temp, { force: true }); }
}

function archiveReferences(ownerId: number, buffer: Buffer | null): Map<string, string> {
  if (!buffer) return referenceMap(ownerId); // Older ZIPs without a manifest.
  const manifest = JSON.parse(buffer.toString("utf8")) as { version: number; files: Array<{ reference: string; entry: string }> };
  if (![2, 3].includes(manifest.version) || !Array.isArray(manifest.files) || manifest.files.length > MAX_ENTRIES) {
    throw new AppError("지원하지 않는 표지 ZIP manifest입니다.");
  }
  const owned = new Set(localReferences(ownerId));
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const item of manifest.files) {
    if (typeof item.reference !== "string" || typeof item.entry !== "string"
      || item.entry !== archiveEntryForReference(item.reference, manifest.version)) throw new AppError("잘못된 표지 ZIP 매핑입니다.");
    const reference = owned.has(item.reference) ? item.reference : normalizeImportedCoverReference(ownerId, item.reference);
    if (!reference || !owned.has(reference) || ambiguous.has(item.entry)) continue;
    if (map.has(item.entry) && map.get(item.entry) !== reference) { map.delete(item.entry); ambiguous.add(item.entry); }
    else map.set(item.entry, reference);
  }
  return map;
}

// Consume one entry at a time, including the preflight pass. Never materialize
// the central directory: an upload can contain millions of tiny records.
async function* archiveEntries(archivePath: string): AsyncGenerator<ZipEntry> {
  const input = fs.createReadStream(archivePath);
  const parser = unzipper.Parse({ forceStream: true });
  input.on("error", error => parser.destroy(error));
  input.pipe(parser);
  let count = 0, expandedBytes = 0;
  try {
    for await (const entry of parser) {
      if (++count > MAX_ENTRIES) {
        entry.destroy();
        throw new AppError("ZIP 항목 수가 제한을 초과했습니다.");
      }
      // The consumer must fully read the entry before asking for the next one.
      try {
        yield {
          path: entry.path, type: entry.type,
          async *[Symbol.asyncIterator]() {
            for await (const chunk of entry) {
              const buffer = Buffer.from(chunk);
              expandedBytes += buffer.length;
              if (expandedBytes > MAX_EXPANDED_BYTES) throw new AppError("ZIP 압축 해제 크기가 2GiB를 초과합니다.");
              yield buffer;
            }
          }
        };
      } finally { entry.destroy(); }
    }
  } finally { input.destroy(); parser.destroy(); }
}

function archiveMemberId(name: string): string {
  return createHash("sha256").update(name).digest("hex");
}

async function inspectArchive(archivePath: string): Promise<{ manifest: Buffer | null; members: Set<string> }> {
  let manifest: Buffer | null = null;
  const members = new Set<string>();
  for await (const entry of archiveEntries(archivePath)) {
    const name = path.posix.normalize(entry.path).replace(/^\.\//, "");
    const isManifest = entry.type === "File" && name === "manifest.json";
    if (isManifest && manifest) throw new AppError("ZIP manifest가 중복되었습니다.");
    const consumed = await consumeEntry(entry, isManifest);
    if (isManifest) manifest = consumed.buffer;
    // Retain fixed-size identities, not up to 50,000 untrusted long names.
    else if (entry.type === "File") members.add(archiveMemberId(name));
  }
  return { manifest, members };
}

export function recoverInterruptedCoverArchiveJobs(): void {
  sqlite.prepare(`
    UPDATE backup_upload_job SET status = 'FAILED', lock_token = NULL,
      message = '워커 재기동으로 표지 복원 작업이 중단되었습니다. ZIP을 다시 업로드해 주세요.',
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'PROCESSING'
  `).run();
  recoverStaleCoverAssemblies();
}

// Safe during normal worker operation: never recovers a live PROCESSING job.
export function recoverStaleCoverAssemblies(): void {
  const failed = sqlite.prepare(`
    UPDATE backup_upload_job SET status = 'FAILED', lock_token = NULL,
      message = '웹 프로세스 중단으로 ZIP 조립이 완료되지 않았습니다. 다시 업로드해 주세요.',
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'ASSEMBLING' AND updated_at < datetime('now', '-15 minutes')
    RETURNING upload_id AS uploadId
  `).all() as Array<{ uploadId: string }>;
  for (const job of failed) discardFailedCoverUploadFiles(job.uploadId);
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
  let restored = 0, skipped = 0;
  try {
    const archive = await inspectArchive(archivePath);
    const allowed = archiveReferences(job.ownerId, archive.manifest);
    if (archive.manifest) {
      for (const [entry, reference] of allowed) {
        if (!archive.members.has(archiveMemberId(entry)) && !(await validCover(targetForReference(reference)))) {
          throw new AppError("ZIP manifest에 선언된 표지 파일이 누락되었습니다.");
        }
      }
    }
    for await (const entry of archiveEntries(archivePath)) {
      const normalized = path.posix.normalize(entry.path).replace(/^\.\//, "");
      if (entry.type !== "File") {
        await consumeEntry(entry, false);
        continue;
      }
      const reference = normalized === "manifest.json" ? null : allowed.get(normalized);
      const target = reference ? targetForReference(reference) : null;
      const shouldRestore = Boolean(reference && target && !(await validCover(target)));
      const consumed = await consumeEntry(entry, shouldRestore);
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
      if (await publishCover(target, buffer)) restored += 1;
      else skipped += 1;
      sqlite.prepare("UPDATE backup_upload_job SET message = ?, updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?")
        .run(`표지를 복원 중입니다. ${restored}개 복원`, job.uploadId);
    }

    const generated = await coverGeneratedState(job.ownerId);
    if (archive.manifest && [...allowed.values()].some(reference => !generated.get(reference))) {
      throw new AppError("ZIP manifest에 선언된 표지를 정상적으로 복원하지 못했습니다.");
    }
    const transaction = sqlite.transaction(() => {
      synchronizeCoverGenerated(job.ownerId, generated);
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
    discardFailedCoverUploadFiles(job.uploadId);
    logger.error("Cover archive restore failed", { uploadId: job.uploadId, error: String(error) });
  }
  return true;
}
