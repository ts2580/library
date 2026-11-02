import "server-only";
import { sqlite } from "@/db";
import type { StockRefreshLogEntry, StockRefreshLogPage, StockRefreshRun } from "@/features/inventory/types";

export interface StockRefreshOutcome {
  status: "SUCCESS" | "EMPTY" | "FAILED";
  code: string;
  message: string;
}

export function recordStockRefreshResult(lockToken: string, ownerId: number, target: { id: number; bookId: number; isbn13: string | null }, outcome: StockRefreshOutcome): void {
  const message = outcome.message.replace(/https?:\/\/\S+/gi, "[외부 주소]")
    .replace(/\b(ttbkey|token|password|secret|authorization)\s*[:=]\s*[^\s,]+/gi, "$1=[비밀값 제거]").slice(0, 1000);
  sqlite.transaction(() => {
    const job = sqlite.prepare(`SELECT COALESCE(run_id,?) runId FROM stock_refresh_job
      WHERE id=1 AND status='RUNNING' AND lock_token=? AND requested_by=?`)
      .get(lockToken, lockToken, ownerId) as { runId: string } | undefined;
    if (!job || !sqlite.prepare(`SELECT 1 FROM book_volumes v JOIN books b ON b.id=v.book
      WHERE v.id=? AND v.book=? AND b.owner_id=?`).get(target.id, target.bookId, ownerId)) return;
    // Keep only the unresolved failure for a volume; success/empty resolves it without adding detail history.
    sqlite.prepare("DELETE FROM stock_refresh_log WHERE owner_id=? AND volume_id=?").run(ownerId, target.id);
    if (outcome.status === "FAILED") sqlite.prepare(`INSERT INTO stock_refresh_log(owner_id,book_id,volume_id,run_id,isbn13,status,code,message)
      VALUES(?,?,?,?,?,'FAILED',?,?)`).run(ownerId, target.bookId, target.id, job.runId, target.isbn13, outcome.code, message);
  }).immediate();
}

/** Called in the same transaction as job lifecycle transitions. */
export function recordStockRefreshRun(): void {
  sqlite.prepare(`INSERT INTO stock_refresh_run(owner_id,run_id,status,total,started_at,finished_at)
    SELECT requested_by,run_id,status,total,started_at,finished_at FROM stock_refresh_job
    WHERE id=1 AND requested_by IS NOT NULL AND run_id IS NOT NULL AND status<>'IDLE'
    ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,total=excluded.total,
      started_at=excluded.started_at,finished_at=excluded.finished_at`).run();
}

const ownedLogs = `FROM stock_refresh_log l
  JOIN book_volumes v ON v.id=l.volume_id AND v.book=l.book_id
  JOIN books b ON b.id=v.book
  WHERE l.owner_id=? AND b.owner_id=?`;
const unresolved = `AND l.status='FAILED'
  AND l.id=(SELECT MAX(last.id) FROM stock_refresh_log last WHERE last.owner_id=l.owner_id AND last.volume_id=l.volume_id)
  AND COALESCE(v.ispurchased,0)=0 AND COALESCE(v.noneedtobuy,0)=0`;

export function getFailedStockVolumeIds(ownerId: number): number[] {
  return (sqlite.prepare(`SELECT l.volume_id id ${ownedLogs} ${unresolved} ORDER BY l.volume_id`)
    .all(ownerId, ownerId) as Array<{ id: number }>).map(row => row.id);
}

export function getStockRefreshFailureCount(ownerId: number): number {
  return (sqlite.prepare(`SELECT COUNT(*) count ${ownedLogs} ${unresolved}`).get(ownerId, ownerId) as { count: number }).count;
}

export function getStockRefreshLogs(ownerId: number, input: { page?: number; status?: "failed" | "all" } = {}): StockRefreshLogPage {
  if (input.status === "all") {
    const total = (sqlite.prepare("SELECT COUNT(*) count FROM stock_refresh_run WHERE owner_id=?").get(ownerId) as {count:number}).count;
    const totalPages = Math.max(1, Math.ceil(total / 24));
    const page = Math.min(totalPages, Math.max(1, Math.floor(input.page || 1)));
    const runs = sqlite.prepare(`SELECT id,run_id runId,status,total,started_at startedAt,finished_at finishedAt,
      CASE WHEN started_at IS NULL THEN NULL ELSE MAX(0,unixepoch(COALESCE(finished_at,CURRENT_TIMESTAMP))-unixepoch(started_at)) END durationSeconds
      FROM stock_refresh_run WHERE owner_id=? ORDER BY id DESC LIMIT 24 OFFSET ?`)
      .all(ownerId, (page - 1) * 24) as StockRefreshRun[];
    return {items:[],runs,total,page,totalPages,pendingFailures:getStockRefreshFailureCount(ownerId)};
  }
  const filter = unresolved;
  const total = (sqlite.prepare(`SELECT COUNT(*) count ${ownedLogs} ${filter}`).get(ownerId, ownerId) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(total / 24));
  const page = Math.min(totalPages, Math.max(1, Math.floor(input.page || 1)));
  const items = sqlite.prepare(`SELECT l.id,b.id bookId,COALESCE(b.name,'제목 없음') bookName,
    v.id volumeId,COALESCE(v.name,b.name,'제목 없음') volumeName,v.volume,COALESCE(NULLIF(v.isbn13,''),NULLIF(v.isbn,''),l.isbn13) isbn13,l.status,l.code,l.message,l.created_at createdAt,
    CASE WHEN COALESCE(v.ispurchased,0)=0 AND COALESCE(v.noneedtobuy,0)=0 THEN 1 ELSE 0 END retryable
    ${ownedLogs} ${filter} ORDER BY l.id DESC LIMIT 24 OFFSET ?`).all(ownerId, ownerId, (page - 1) * 24) as Array<Omit<StockRefreshLogEntry, "retryable"> & { retryable: number }>;
  return { runs: [], items: items.map(row => ({ ...row, retryable: Boolean(row.retryable) })), total, page, totalPages,
    pendingFailures: getStockRefreshFailureCount(ownerId) };
}
