import "server-only";
import { sqlite } from "@/db";
import type { StockRefreshLogEntry, StockRefreshLogPage } from "@/features/inventory/types";

export interface StockRefreshOutcome {
  status: "SUCCESS" | "EMPTY" | "FAILED";
  code: string;
  message: string;
}

export function recordStockRefreshResult(lockToken: string, ownerId: number, target: { id: number; bookId: number; isbn13: string | null }, outcome: StockRefreshOutcome): void {
  const message = outcome.message.replace(/https?:\/\/\S+/gi, "[외부 주소]")
    .replace(/\b(ttbkey|token|password|secret|authorization)\s*[:=]\s*[^\s,]+/gi, "$1=[비밀값 제거]").slice(0, 1000);
  sqlite.prepare(`INSERT INTO stock_refresh_log(owner_id,book_id,volume_id,run_id,isbn13,status,code,message)
    SELECT ?,?,?,COALESCE(j.run_id,?),?,?,?,? FROM stock_refresh_job j
    JOIN book_volumes v ON v.id=? AND v.book=? JOIN books b ON b.id=v.book AND b.owner_id=?
    WHERE j.id=1 AND j.status='RUNNING' AND j.lock_token=? AND j.requested_by=?
    ON CONFLICT(run_id,volume_id) DO UPDATE SET status=excluded.status,code=excluded.code,message=excluded.message,created_at=CURRENT_TIMESTAMP`)
    .run(ownerId, target.bookId, target.id, lockToken, target.isbn13, outcome.status, outcome.code, message,
      target.id, target.bookId, ownerId, lockToken, ownerId);
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
  const filter = input.status === "all" ? "" : unresolved;
  const total = (sqlite.prepare(`SELECT COUNT(*) count ${ownedLogs} ${filter}`).get(ownerId, ownerId) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(total / 24));
  const page = Math.min(totalPages, Math.max(1, Math.floor(input.page || 1)));
  const items = sqlite.prepare(`SELECT l.id,b.id bookId,COALESCE(b.name,'제목 없음') bookName,
    v.id volumeId,COALESCE(v.name,b.name,'제목 없음') volumeName,v.volume,l.isbn13,l.status,l.code,l.message,l.created_at createdAt,
    CASE WHEN COALESCE(v.ispurchased,0)=0 AND COALESCE(v.noneedtobuy,0)=0 THEN 1 ELSE 0 END retryable
    ${ownedLogs} ${filter} ORDER BY l.id DESC LIMIT 24 OFFSET ?`).all(ownerId, ownerId, (page - 1) * 24) as Array<Omit<StockRefreshLogEntry, "retryable"> & { retryable: number }>;
  return { items: items.map(row => ({ ...row, retryable: Boolean(row.retryable) })), total, page, totalPages,
    pendingFailures: getStockRefreshFailureCount(ownerId) };
}
