import "server-only";
import { randomUUID } from "node:crypto";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { isAladinConfigured } from "@/features/aladin/client";
import { enrichMissingBookInfo } from "@/features/books/enrichment";
import type { MetadataEnrichmentProgress } from "@/features/books/enrichment-types";
import { logger } from "@/lib/logger";

const active = (job: MetadataEnrichmentProgress | null) => job?.status === "QUEUED" || job?.status === "RUNNING";
const progressColumns = `run_id AS runId,status,total,processed,books_updated AS booksUpdated,
  volumes_updated AS volumesUpdated,failed,skipped,message`;

export function getMetadataEnrichmentProgress(ownerId: number): MetadataEnrichmentProgress | null {
  return sqlite.prepare(`SELECT ${progressColumns} FROM metadata_enrichment_job WHERE owner_id=?`).get(ownerId) as MetadataEnrichmentProgress | undefined ?? null;
}

export function requestMetadataEnrichment(ownerId: number): MetadataEnrichmentProgress {
  if (!isAladinConfigured()) throw new AppError("알라딘 검색을 설정한 뒤 다시 시도해 주세요.");
  return sqlite.transaction(() => {
    const current = getMetadataEnrichmentProgress(ownerId);
    if (active(current)) throw new AppError("전체 정보 보강이 이미 진행 중입니다.", "JOB_ACTIVE", 409);
    const rows = sqlite.prepare(`SELECT b.id,b.author,b.description,v.id AS volumeId,v.author AS volumeAuthor,v.description AS volumeDescription
      FROM books b LEFT JOIN book_volumes v ON v.book=b.id WHERE b.owner_id=? ORDER BY b.id`).all(ownerId) as Array<{
        id: number; author: string | null; description: string | null; volumeId: number | null; volumeAuthor: string | null; volumeDescription: string | null;
      }>;
    const blank = (value: string | null) => !value?.trim();
    const ids = [...new Set(rows.filter(row => blank(row.author) || blank(row.description)
      || (row.volumeId != null && (blank(row.volumeAuthor) || blank(row.volumeDescription)))).map(row => row.id))];
    sqlite.prepare(`INSERT INTO metadata_enrichment_job(owner_id,run_id,status,book_ids,total,message)
      VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET run_id=excluded.run_id,status=excluded.status,
      book_ids=excluded.book_ids,total=excluded.total,processed=0,books_updated=0,volumes_updated=0,failed=0,skipped=0,
      message=excluded.message,updated_at=CURRENT_TIMESTAMP`).run(ownerId, randomUUID(), ids.length ? "QUEUED" : "COMPLETED", JSON.stringify(ids), ids.length,
        ids.length ? `${ids.length}개 책의 빈 저자·설명을 보강합니다.` : "채울 저자·설명이 없습니다.");
    return getMetadataEnrichmentProgress(ownerId)!;
  }).immediate();
}

// One book per worker iteration leaves stock/cover jobs a turn and resumes after restart.
export async function processNextMetadataEnrichmentJob(): Promise<boolean> {
  const job = sqlite.prepare(`SELECT ${progressColumns},owner_id AS ownerId,book_ids AS bookIds
    FROM metadata_enrichment_job WHERE status IN ('QUEUED','RUNNING') ORDER BY updated_at,owner_id LIMIT 1`)
    .get() as (MetadataEnrichmentProgress & { ownerId: number; bookIds: string }) | undefined;
  if (!job) return false;
  sqlite.prepare("UPDATE metadata_enrichment_job SET status='RUNNING',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND run_id=?")
    .run(job.ownerId, job.runId);
  const bookId = (JSON.parse(job.bookIds) as number[])[job.processed];
  let booksUpdated = 0, volumesUpdated = 0, failed = 0, skipped = 0;
  try {
    const result = await enrichMissingBookInfo(job.ownerId, bookId, { includeLinks: false });
    booksUpdated = result.booksUpdated; volumesUpdated = result.volumesUpdated;
    skipped = Number(!booksUpdated && !volumesUpdated);
  } catch (error) {
    if (error instanceof NotFoundError) skipped = 1;
    else {
      failed = 1;
      logger.error("Metadata enrichment failed", { ownerId: job.ownerId, bookId, error: error instanceof AppError ? error.code : "INTERNAL_ERROR" });
    }
  }
  const processed = job.processed + 1;
  const done = processed >= job.total;
  const message = done
    ? `전체 정보 보강 완료: 책 ${job.booksUpdated + booksUpdated}건, 권 ${job.volumesUpdated + volumesUpdated}건 · 변경 없음 ${job.skipped + skipped}건 · 실패 ${job.failed + failed}건`
    : `${processed}/${job.total}개 책 확인 중`;
  sqlite.prepare(`UPDATE metadata_enrichment_job SET status=?,processed=?,books_updated=books_updated+?,volumes_updated=volumes_updated+?,
    failed=failed+?,skipped=skipped+?,message=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND run_id=? AND processed=?`)
    .run(done ? "COMPLETED" : "RUNNING", processed, booksUpdated, volumesUpdated, failed, skipped, message, job.ownerId, job.runId, job.processed);
  return true;
}
