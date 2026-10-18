import "server-only";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { randomUUID } from "node:crypto";
import { sqlite } from "@/db";
import { env } from "@/lib/env";
import { AppError, errorMessage } from "@/lib/errors";
import { safeFilename } from "@/lib/strings";
import { discardFailedCoverUploadFiles } from "@/features/backup/upload-cleanup";

export const CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_ARCHIVE_SIZE / CHUNK_SIZE);
const MAX_ACTIVE_UPLOADS_PER_OWNER = 2;
const ABANDONED_UPLOAD_HOURS = 24;

export interface UploadRow {
  uploadId: string;
  ownerId: number;
  originalFilename: string;
  totalSize: number;
  totalChunks: number;
  uploadedChunks: number;
  status: "UPLOADING" | "ASSEMBLING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  message: string | null;
}

function uploadDir(uploadId: string): string {
  return path.join(env.uploadsDir, uploadId);
}

function readJob(uploadId: string, ownerId: number): UploadRow {
  const row = sqlite.prepare(`
    SELECT upload_id AS uploadId, owner_id AS ownerId, original_filename AS originalFilename,
      total_size AS totalSize, total_chunks AS totalChunks, uploaded_chunks AS uploadedChunks,
      status, message
    FROM backup_upload_job WHERE upload_id = ? AND owner_id = ?
  `).get(uploadId, ownerId) as UploadRow | undefined;
  if (!row) throw new AppError("업로드 작업을 찾을 수 없습니다.", "NOT_FOUND", 404);
  return row;
}

function cleanupAbandonedUploads(ownerId: number): void {
  const rows = sqlite.prepare(`
    SELECT upload_id AS uploadId
    FROM backup_upload_job
    WHERE owner_id = ?
      AND status IN ('UPLOADING', 'ASSEMBLING', 'FAILED', 'COMPLETED')
      AND updated_at < datetime('now', ?)
  `).all(ownerId, `-${ABANDONED_UPLOAD_HOURS} hours`) as Array<{ uploadId: string }>;
  if (!rows.length) return;
  const remove = sqlite.prepare("DELETE FROM backup_upload_job WHERE upload_id = ? AND owner_id = ?");
  for (const row of rows) {
    fs.rmSync(uploadDir(row.uploadId), { recursive: true, force: true });
    remove.run(row.uploadId, ownerId);
  }
}

export function createCoverUpload(ownerId: number, input: { filename: string; totalSize: number; totalChunks: number }): UploadRow {
  if (!input.filename.toLowerCase().endsWith(".zip")) throw new AppError("ZIP 파일만 업로드할 수 있습니다.");
  if (!Number.isInteger(input.totalSize) || input.totalSize <= 0 || input.totalSize > MAX_ARCHIVE_SIZE) {
    throw new AppError("표지 ZIP은 2GiB 이하여야 합니다.");
  }
  const expectedChunks = Math.ceil(input.totalSize / CHUNK_SIZE);
  if (!Number.isInteger(input.totalChunks) || input.totalChunks !== expectedChunks || input.totalChunks > MAX_CHUNKS) {
    throw new AppError("청크 개수가 파일 크기와 일치하지 않습니다.");
  }

  cleanupAbandonedUploads(ownerId);
  const uploadId = randomUUID();
  const transaction = sqlite.transaction(() => {
    const rows = sqlite.prepare(`
      SELECT upload_id AS uploadId, total_size AS totalSize, status
      FROM backup_upload_job
      WHERE owner_id = ? AND status IN ('UPLOADING', 'ASSEMBLING', 'QUEUED', 'PROCESSING', 'FAILED')
    `).all(ownerId) as Array<{ uploadId: string; totalSize: number; status: string }>;
    // Failed files that could not be removed still reserve their bytes and job slot.
    const retained = rows.filter(row => row.status !== "FAILED" || !discardFailedCoverUploadFiles(row.uploadId));
    const usage = { activeCount: retained.length, activeBytes: retained.reduce((sum, row) => sum + row.totalSize, 0) };
    if (usage.activeCount >= MAX_ACTIVE_UPLOADS_PER_OWNER) {
      throw new AppError("진행 중이거나 정리 대기 중인 표지 ZIP 작업은 계정당 2개까지 가능합니다.", "UPLOAD_LIMIT", 409);
    }
    if (usage.activeBytes + input.totalSize > MAX_ARCHIVE_SIZE) {
      throw new AppError("계정의 진행 중이거나 정리 대기 중인 표지 ZIP 총량이 2GiB를 초과합니다.", "UPLOAD_LIMIT", 409);
    }
    sqlite.prepare(`
      INSERT INTO backup_upload_job(upload_id, owner_id, original_filename, total_size, total_chunks,
        uploaded_chunks, status, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 'UPLOADING', '표지 ZIP 청크 업로드 중입니다.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(uploadId, ownerId, safeFilename(input.filename, "covers.zip"), input.totalSize, input.totalChunks);
  });
  transaction.immediate();

  try {
    fs.mkdirSync(uploadDir(uploadId), { recursive: false });
  } catch (error) {
    sqlite.prepare("DELETE FROM backup_upload_job WHERE upload_id = ? AND owner_id = ?").run(uploadId, ownerId);
    throw error;
  }
  return readJob(uploadId, ownerId);
}

export async function saveCoverChunk(ownerId: number, uploadId: string, index: number, request: Request): Promise<UploadRow> {
  const job = readJob(uploadId, ownerId);
  if (job.status !== "UPLOADING") throw new AppError("이미 업로드가 종료된 작업입니다.");
  if (!Number.isInteger(index) || index < 0 || index >= job.totalChunks) throw new AppError("청크 번호가 올바르지 않습니다.");
  const expected = index === job.totalChunks - 1 ? job.totalSize - CHUNK_SIZE * index : CHUNK_SIZE;
  const lengthHeader = request.headers.get("content-length");
  const length = lengthHeader == null ? null : Number(lengthHeader);
  if (length != null && (!Number.isFinite(length) || length !== expected)) {
    throw new AppError(`청크 크기가 올바르지 않습니다. 기대값: ${expected}`);
  }
  if (!request.body) throw new AppError("청크 본문이 없습니다.");

  const dir = uploadDir(uploadId);
  const target = path.join(dir, `${index}.part`);
  const temp = `${target}.${randomUUID()}.tmp`;
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > expected) callback(new AppError("청크가 허용 크기를 초과했습니다."));
      else callback(null, chunk);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body as never),
      limiter,
      fs.createWriteStream(temp, { flags: "wx" })
    );
    if (received !== expected) throw new AppError("수신한 청크 크기가 올바르지 않습니다.");
    fs.rmSync(target, { force: true });
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }

  const uploadedChunks = fs.readdirSync(dir).filter((name) => /^\d+\.part$/.test(name)).length;
  sqlite.prepare(`
    UPDATE backup_upload_job SET uploaded_chunks = ?, updated_at = CURRENT_TIMESTAMP,
      message = ? WHERE upload_id = ? AND owner_id = ? AND status = 'UPLOADING'
  `).run(uploadedChunks, `청크 ${uploadedChunks}/${job.totalChunks} 업로드 완료`, uploadId, ownerId);
  return readJob(uploadId, ownerId);
}

export async function completeCoverUpload(ownerId: number, uploadId: string): Promise<UploadRow> {
  const job = readJob(uploadId, ownerId);
  if (job.status !== "UPLOADING") return job;
  const token = `assemble:${randomUUID()}`;
  const claim = sqlite.prepare(`
    UPDATE backup_upload_job SET status = 'ASSEMBLING', lock_token = ?,
      message = '표지 ZIP 청크를 조립하고 있습니다.', updated_at = CURRENT_TIMESTAMP
    WHERE upload_id = ? AND owner_id = ? AND status = 'UPLOADING'
  `).run(token, uploadId, ownerId);
  if (claim.changes !== 1) return readJob(uploadId, ownerId);

  const dir = uploadDir(uploadId);
  const assembled = path.join(dir, "archive.zip");
  const temporary = `${assembled}.${randomUUID()}.tmp`;
  try {
    for (let i = 0; i < job.totalChunks; i += 1) {
      if (!fs.existsSync(path.join(dir, `${i}.part`))) throw new AppError(`청크 ${i + 1}이 없습니다.`);
    }
    for (let i = 0; i < job.totalChunks; i += 1) {
      await pipeline(
        fs.createReadStream(path.join(dir, `${i}.part`)),
        fs.createWriteStream(temporary, { flags: i === 0 ? "wx" : "a" })
      );
      const heartbeat = sqlite.prepare(`UPDATE backup_upload_job SET updated_at=CURRENT_TIMESTAMP
        WHERE upload_id=? AND owner_id=? AND status='ASSEMBLING' AND lock_token=?`).run(uploadId, ownerId, token);
      if (heartbeat.changes !== 1) throw new AppError("ZIP 조립 작업이 만료되었습니다. 다시 업로드해 주세요.");
    }
    if (fs.statSync(temporary).size !== job.totalSize) throw new AppError("조립된 ZIP 크기가 원본과 다릅니다.");
    fs.rmSync(assembled, { force: true });
    fs.renameSync(temporary, assembled);
    for (let i = 0; i < job.totalChunks; i += 1) fs.rmSync(path.join(dir, `${i}.part`), { force: true });
    sqlite.prepare(`
      UPDATE backup_upload_job SET status = 'QUEUED', lock_token = NULL,
        message = '표지 ZIP 복원 대기 중입니다.', uploaded_chunks = total_chunks,
        updated_at = CURRENT_TIMESTAMP
      WHERE upload_id = ? AND owner_id = ? AND status = 'ASSEMBLING'
    `).run(uploadId, ownerId);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    sqlite.prepare(`
      UPDATE backup_upload_job SET status = 'FAILED', lock_token = NULL,
        message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE upload_id = ? AND owner_id = ?
    `).run(`표지 ZIP 조립 실패: ${errorMessage(error, "내부 오류가 발생했습니다. 다시 업로드해 주세요.")}`, uploadId, ownerId);
    discardFailedCoverUploadFiles(uploadId);
    throw error;
  }
  return readJob(uploadId, ownerId);
}

export function getCoverUploadStatus(ownerId: number, uploadId: string): UploadRow & { percent: number; completed: boolean; processing: boolean } {
  const row = readJob(uploadId, ownerId);
  const uploadPercent = row.totalChunks <= 0 ? 0 : Math.round(row.uploadedChunks * 100 / row.totalChunks);
  return {
    ...row,
    percent: row.status === "COMPLETED" ? 100 : uploadPercent,
    completed: row.status === "COMPLETED",
    processing: row.status === "ASSEMBLING" || row.status === "QUEUED" || row.status === "PROCESSING"
  };
}
