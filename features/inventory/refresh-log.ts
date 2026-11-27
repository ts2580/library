import "server-only";
import { NotFoundError } from "@/lib/errors";
import { sqlite } from "@/db";
import type { StockRefreshLogEntry, StockRefreshLogPage, StockRefreshRun } from "@/features/inventory/types";

export interface StockRefreshOutcome {
  status: "SUCCESS" | "EMPTY" | "FAILED";
  code: string;
  message: string;
}

export function recordStockRefreshResult(lockToken: string, ownerId: number, target: { id: number; bookId: number; isbn13: string | null; bookName: string | null; name: string | null; seq: number | null }, outcome: StockRefreshOutcome): void {
  const message = outcome.message.replace(/https?:\/\/\S+/gi, "[외부 주소]")
    .replace(/\b(ttbkey|token|password|secret|authorization)\s*[:=]\s*[^\s,]+/gi, "$1=[비밀값 제거]").slice(0, 1000);
  sqlite.transaction(() => {
    const job = sqlite.prepare(`SELECT COALESCE(run_id,?) runId FROM stock_refresh_job
      WHERE id=1 AND status='RUNNING' AND lock_token=? AND requested_by=?`)
      .get(lockToken, lockToken, ownerId) as { runId: string } | undefined;
    if (!job) return;
    if (outcome.status === "FAILED") {
      sqlite.prepare(`INSERT INTO stock_refresh_error(run_id,book_id,volume_id,book_name,volume_name,volume,isbn13,code,message,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(job.runId,target.bookId,target.id,target.bookName ?? "제목 없음",
          target.name ?? target.bookName ?? "제목 없음",target.seq,target.isbn13,outcome.code,message);
    }
    if (!sqlite.prepare(`SELECT 1 FROM book_volumes v JOIN books b ON b.id=v.book
      WHERE v.id=? AND v.book=? AND b.owner_id=?`).get(target.id, target.bookId, ownerId)) return;
    if (outcome.status !== "FAILED") {
      sqlite.prepare(`UPDATE stock_refresh_error SET resolved_at=CURRENT_TIMESTAMP WHERE volume_id=? AND resolved_at IS NULL
        AND run_id IN (SELECT run_id FROM stock_refresh_run WHERE owner_id=?)`).run(target.id,ownerId);
    }
    // One current failure per volume drives the inventory-wide retry.
    sqlite.prepare("DELETE FROM stock_refresh_log WHERE owner_id=? AND volume_id=?").run(ownerId, target.id);
    if (outcome.status === "FAILED") sqlite.prepare(`INSERT INTO stock_refresh_log(owner_id,book_id,volume_id,run_id,isbn13,status,code,message)
      VALUES(?,?,?,?,?,'FAILED',?,?)`).run(ownerId, target.bookId, target.id, job.runId, target.isbn13, outcome.code, message);
  }).immediate();
}

/** Called in the same transaction as job lifecycle transitions. */
export function recordStockRefreshRun(): void {
  sqlite.prepare(`INSERT INTO stock_refresh_run(owner_id,run_id,status,total,started_at,finished_at,processed,success,empty,fail,message,mode)
    SELECT requested_by,run_id,status,total,started_at,finished_at,processed,success,empty,fail,message,mode FROM stock_refresh_job
    WHERE id=1 AND requested_by IS NOT NULL AND run_id IS NOT NULL AND status<>'IDLE'
    ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,total=excluded.total,
      started_at=excluded.started_at,finished_at=excluded.finished_at, processed=excluded.processed,success=excluded.success,
      empty=excluded.empty,fail=excluded.fail,message=excluded.message,mode=excluded.mode`).run();
}

const ownedLogs = `FROM stock_refresh_log l
  JOIN book_volumes v ON v.id=l.volume_id AND v.book=l.book_id
  JOIN books b ON b.id=v.book
  WHERE l.owner_id=? AND b.owner_id=?`;
const unresolved = `AND l.status='FAILED'
  AND l.id=(SELECT MAX(last.id) FROM stock_refresh_log last WHERE last.owner_id=l.owner_id AND last.volume_id=l.volume_id)
  AND COALESCE(v.ispurchased,0)=0 AND COALESCE(v.noneedtobuy,0)=0`;

const failedInRun = `AND EXISTS (SELECT 1 FROM stock_refresh_error e JOIN stock_refresh_run r ON r.run_id=e.run_id
  WHERE e.run_id=? AND r.owner_id=l.owner_id AND e.volume_id=l.volume_id AND e.resolved_at IS NULL)`;

export function getFailedStockVolumeIds(ownerId: number, runId?: string): number[] {
  const runFilter = runId ? failedInRun : "";
  return (sqlite.prepare(`SELECT l.volume_id id ${ownedLogs} ${unresolved} ${runFilter} ORDER BY l.volume_id`)
    .all(ownerId, ownerId, ...(runId ? [runId] : [])) as Array<{ id: number }>).map(row => row.id);
}

export function getStockRefreshFailureCount(ownerId: number): number {
  return (sqlite.prepare(`SELECT COUNT(*) count ${ownedLogs} ${unresolved}`).get(ownerId, ownerId) as { count: number }).count;
}

const runQuery = `SELECT id,run_id runId,status,total,mode,processed,success,empty,fail,message,started_at startedAt,finished_at finishedAt,
      CASE WHEN started_at IS NULL THEN NULL ELSE MAX(0,unixepoch(COALESCE(finished_at,CURRENT_TIMESTAMP))-unixepoch(started_at)) END durationSeconds
      FROM stock_refresh_run`;

export function getStockRefreshLogs(ownerId: number, input: { page?: number; status?: "failed" | "all" } = {}): StockRefreshLogPage {
  if (input.status === "all") {
    const total = (sqlite.prepare("SELECT COUNT(*) count FROM stock_refresh_run WHERE owner_id=?").get(ownerId) as {count:number}).count;
    const totalPages = Math.max(1, Math.ceil(total / 24));
    const page = Math.min(totalPages, Math.max(1, Math.floor(input.page || 1)));
    const runs = sqlite.prepare(`${runQuery} WHERE owner_id=? ORDER BY id DESC LIMIT 24 OFFSET ?`)
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

export function getStockRunDetail(ownerId: number, runId: string, pageNumber = 1, full = false): StockRefreshLogPage {
  return sqlite.transaction(() => {
    const run = sqlite.prepare(`${runQuery} WHERE owner_id=? AND run_id=?`).get(ownerId, runId) as StockRefreshRun | undefined;
    if (!run) throw new NotFoundError("작업 기록을 찾을 수 없습니다.");
    const total = (sqlite.prepare("SELECT COUNT(*) n FROM stock_refresh_error WHERE run_id=?").get(runId) as { n: number }).n;
    const totalPages = Math.max(1, Math.ceil(total / 24));
    const page = Math.min(totalPages, Math.max(1, Math.floor(pageNumber || 1)));
    const pendingFailures = (sqlite.prepare(`SELECT COUNT(*) n ${ownedLogs} ${unresolved} ${failedInRun}`)
      .get(ownerId, ownerId, runId) as { n: number }).n;
    const rows = sqlite.prepare(`SELECT e.id,e.book_id bookId,e.book_name bookName,e.volume_id volumeId,
      e.volume_name volumeName,e.volume,e.isbn13,'FAILED' status,e.code,e.message,e.created_at createdAt,
      COALESCE(NULLIF(v.isbn13,''), NULLIF(v.isbn,'')) currentIsbn, b.id IS NOT NULL bookExists,
      CASE WHEN e.resolved_at IS NOT NULL THEN 'RESOLVED'
           WHEN v.id IS NULL OR COALESCE(v.ispurchased,0)<>0 OR COALESCE(v.noneedtobuy,0)<>0 THEN 'INELIGIBLE'
           WHEN latest.status='FAILED' THEN 'PENDING'
           ELSE 'RESOLVED' END resolution
      FROM stock_refresh_error e LEFT JOIN books b ON b.id=e.book_id AND b.owner_id=?
      LEFT JOIN book_volumes v ON v.id=e.volume_id AND v.book=b.id
      LEFT JOIN stock_refresh_log latest ON latest.id=(
        SELECT MAX(l.id) FROM stock_refresh_log l WHERE l.owner_id=? AND l.volume_id=v.id)
      WHERE e.run_id=? ORDER BY e.id DESC LIMIT ? OFFSET ?`)
      .all(ownerId, ownerId, runId, full ? -1 : 24, full ? 0 : (page - 1) * 24) as Array<Omit<StockRefreshLogEntry,"bookExists" | "retryable"> & {bookExists:number}>;
    const items = rows.map(row => ({ ...row, bookExists: Boolean(row.bookExists), retryable: row.resolution === "PENDING" }));
    return { runs: [run], items, total, page, totalPages, pendingFailures };
  })();
}
