import "server-only";
import { randomUUID } from "node:crypto";
import { rebuildSummaryStatements, resetQueuedInventory } from "@/db/inventory";
import { sqlite } from "@/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AladinRateLimitError, inventoryRequestCheck } from "@/features/aladin/client";
import { lookupUsedStocks } from "@/features/aladin/service";
import { isbn13Schema } from "@/features/aladin/validation";
import { stockIdentity, uniqueStocks } from "@/features/inventory/stock-identity";
import { getFailedStockVolumeIds, recordStockRefreshResult, recordStockRefreshRun } from "@/features/inventory/refresh-log";
import type { AladinBranchStock } from "@/features/aladin/types";

export const STOCK_REFRESH_CONCURRENCY = 10;

interface RefreshTarget {
  id: number;
  bookId: number;
  bookName: string | null;
  link: string | null;
  seq: number | null;
  isbn13: string | null;
  name: string | null;
}

function rememberStockCompletion(): void {
  recordStockRefreshRun();
  sqlite.prepare(`INSERT INTO stock_refresh_completion(owner_id, run_id)
    SELECT requested_by, COALESCE(run_id, ?) FROM stock_refresh_job
    WHERE id=1 AND requested_by IS NOT NULL
    ON CONFLICT(owner_id) DO UPDATE SET run_id=excluded.run_id`).run(randomUUID());
}

function assertScopedBook(ownerId: number, bookId: number | null): void {
  if (bookId == null || !sqlite.prepare("SELECT 1 FROM books WHERE id=? AND owner_id=?").get(bookId, ownerId)) {
    throw new NotFoundError("재고를 검색할 책을 찾을 수 없습니다.");
  }
}

export function requestBookStockSearch(ownerId: number, bookId: number): { started: boolean; message: string } {
  return queueStockJob(ownerId, bookId);
}

export function requestStockRefresh(ownerId: number): { started: boolean; message: string } {
  return queueStockJob(ownerId, null);
}

export function retryStockRefresh(ownerId: number, volumeIds?: number[], runId?: string): { started: boolean; message: string } {
  return queueStockJob(ownerId, null, volumeIds ?? "failed", runId);
}

export function cancelStockRefresh(ownerId: number, runId: string | null): void {
  sqlite.transaction(() => {
    const job = sqlite.prepare("SELECT requested_by AS ownerId, run_id AS runId FROM stock_refresh_job WHERE id=1")
      .get() as { ownerId: number | null; runId: string | null };
    if (job.ownerId !== ownerId) throw new ForbiddenError("다른 계정의 재고 갱신은 취소할 수 없습니다.");
    if (job.runId !== runId) throw new AppError("재고 갱신 작업이 변경되었습니다. 현재 상태를 확인한 뒤 다시 취소해 주세요.", "STOCK_JOB_CHANGED", 409);
    const result = sqlite.prepare(`
      UPDATE stock_refresh_job SET status='CANCELLED', running=0, completed=0, failed=0,
        lock_token=NULL, message='재고 갱신을 취소했습니다. 취소 전까지 저장된 재고는 유지합니다.',
        updated_at=CURRENT_TIMESTAMP, finished_at=CURRENT_TIMESTAMP, heartbeat_at=CURRENT_TIMESTAMP
      WHERE id=1 AND status IN ('QUEUED','RUNNING','PAUSED')
    `).run();
    if (result.changes) {
      rebuildSummaryStatements(sqlite);
      rememberStockCompletion();
    }
  }).immediate();
}

export function changeStockPause(ownerId: number, runId: string | null, action: "pause" | "resume"): void {
  const pause = action === "pause";
  sqlite.transaction(() => {
    const result = sqlite.prepare(`UPDATE stock_refresh_job SET status=?,running=?,lock_token=NULL,
      message=?,updated_at=CURRENT_TIMESTAMP,heartbeat_at=CURRENT_TIMESTAMP
      WHERE id=1 AND requested_by=? AND run_id=? AND status IN (${pause ? "'QUEUED','RUNNING'" : "'PAUSED'"})`)
      .run(pause ? "PAUSED" : "QUEUED", pause ? 0 : 1,
        pause ? "재고 검색을 일시중지했습니다." : "남은 권부터 재고 검색을 재개합니다.", ownerId, runId);
    if (!result.changes) throw new AppError("작업 상태가 변경되었습니다. 현재 상태를 확인해 주세요.", "STOCK_JOB_CHANGED", 409);
    recordStockRefreshRun();
  }).immediate();
}

export function claimStockErrorNotification(ownerId: number, runId: string | null): boolean {
  return sqlite.prepare(`UPDATE stock_refresh_job SET notified_run_id=run_id
    WHERE id=1 AND requested_by=? AND run_id=? AND notified_run_id IS NOT run_id
    AND (status='FAILED' OR (status='COMPLETED' AND fail>0))`).run(ownerId, runId).changes === 1;
}

function queueStockJob(ownerId: number, bookId: number | null, selection?: number[] | "failed", runId?: string): { started: boolean; message: string } {
  return sqlite.transaction(() => {
    if (bookId != null) assertScopedBook(ownerId, bookId);
    const selected = selection === "failed" || runId ? getFailedStockVolumeIds(ownerId, runId) : null;
    const targets = Array.isArray(selection) ? [...new Set(selection)] : selected;
    if (targets) {
      if (!targets.length) throw new AppError("갱신할 권이 없습니다.", "NO_RETRY_TARGETS", 400);
      const allowed = new Set(selected ?? (sqlite.prepare(`SELECT bv.id FROM book_volumes bv JOIN books b ON b.id=bv.book
        WHERE b.owner_id=? AND COALESCE(bv.ispurchased,0)=0 AND COALESCE(bv.noneedtobuy,0)=0`)
        .all(ownerId) as Array<{ id: number }>).map(row => row.id));
      if (targets.some(id => !allowed.has(id))) throw new NotFoundError("선택한 권을 찾을 수 없거나 갱신할 수 없습니다.");
    }
    const total = (sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM book_volumes bv JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ? AND COALESCE(bv.ispurchased, 0) = 0 AND COALESCE(bv.noneedtobuy, 0) = 0
        AND (? IS NULL OR b.id = ?)
    `).get(ownerId, bookId, bookId) as { count: number }).count;
    const result = sqlite.prepare(`
      UPDATE stock_refresh_job SET
        running = 1, completed = 0, failed = 0, total = ?, processed = 0,
        success = 0, empty = 0, fail = 0, percent = 0,
        message = ?, updated_at = CURRENT_TIMESTAMP, mode = ?, scope_book_id = ?,
        status = 'QUEUED', requested_by = ?, run_id = ?, lock_token = NULL,
        started_at = NULL, finished_at = NULL, heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND status NOT IN ('QUEUED', 'RUNNING', 'PAUSED')
    `).run(targets ? targets.length : total, targets ? "선택한 권의 재고 갱신을 기다리고 있습니다." : bookId == null ? "중고 재고 일괄 갱신 대기 중입니다." : "이 책의 재고 갱신을 기다리고 있습니다.",
      targets ? "REFRESH_SELECTED" : bookId == null ? "REPLACE_ALL" : "APPEND_BOOK", bookId, ownerId, randomUUID());
    if (result.changes !== 1) return { started: false, message: "이미 재고 갱신이 진행 중입니다." };
    recordStockRefreshRun();
    sqlite.prepare("DELETE FROM stock_refresh_job_target WHERE job_id=1").run();
    const insert = sqlite.prepare("INSERT INTO stock_refresh_job_target(job_id,volume_id) VALUES(1,?)");
    if (targets) {
      for (const id of targets) insert.run(id);
    } else {
      sqlite.prepare(`INSERT INTO stock_refresh_job_target(job_id,volume_id)
        SELECT 1,v.id FROM book_volumes v JOIN books b ON b.id=v.book
        WHERE b.owner_id=? AND COALESCE(v.ispurchased,0)=0 AND COALESCE(v.noneedtobuy,0)=0
        AND (? IS NULL OR b.id=?)`).run(ownerId, bookId, bookId);
    }
    // Queue admission, target snapshot and inventory reset must commit together.
    resetQueuedInventory(sqlite, ownerId, bookId, targets !== null);
    return { started: true, message: "재고 갱신 작업을 등록했습니다." };
  }).immediate();
}

export function deleteOwnerInventory(ownerId: number): void {
  const transaction = sqlite.transaction(() => {
    const active = sqlite.prepare("SELECT status FROM stock_refresh_job WHERE id = 1").get() as { status: string };
    if (["QUEUED", "RUNNING", "PAUSED"].includes(active.status)) {
      throw new AppError("재고 갱신 중에는 저장 재고를 삭제할 수 없습니다.", "JOB_ACTIVE", 409);
    }
    sqlite.prepare("DELETE FROM branchbook WHERE book IN (SELECT id FROM books WHERE owner_id = ?)").run(ownerId);
    rebuildSummaryStatements(sqlite);
    sqlite.prepare(`
      UPDATE stock_refresh_job SET running = 0, completed = 0, failed = 0, total = 0,
        processed = 0, success = 0, empty = 0, fail = 0, percent = 0,
        message = '지점 재고를 삭제했습니다.', updated_at = CURRENT_TIMESTAMP,
        status = 'IDLE', requested_by = ?, run_id = NULL, lock_token = NULL, finished_at = CURRENT_TIMESTAMP,
        mode = 'REPLACE_ALL', scope_book_id = NULL
      WHERE id = 1
    `).run(ownerId);
    rememberStockCompletion();
  });
  transaction.immediate();
}

export function recoverInterruptedStockJob(): void {
  sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT status FROM stock_refresh_job WHERE id = 1").get() as { status: string };
    if (row.status !== "RUNNING") return;
    rebuildSummaryStatements(sqlite);
    sqlite.prepare(`
    UPDATE stock_refresh_job SET running = 0, failed = 1, completed = 0, status = 'FAILED',
      message = '워커 재기동으로 이전 재고 갱신 작업이 중단되었습니다. 다시 실행해 주세요.',
      updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP, lock_token = NULL
    WHERE id = 1
    `).run();
    rememberStockCompletion();
  }).immediate();
}

function claimStockJob() {
  return sqlite.transaction(() => {
    const lockToken = randomUUID();
    const row = sqlite.prepare(`
      UPDATE stock_refresh_job SET status = 'RUNNING', running = 1, lock_token = ?,
        started_at = COALESCE(started_at,CURRENT_TIMESTAMP), heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        message = CASE WHEN mode='APPEND_BOOK' THEN '이 책의 재고 검색을 준비 중입니다.' WHEN mode='REFRESH_SELECTED' THEN '선택한 권의 재고 갱신을 준비 중입니다.' ELSE '재고 초기화를 준비 중입니다.' END
      WHERE id = 1 AND status = 'QUEUED'
      RETURNING requested_by AS ownerId, total, processed, success, empty, fail, mode, scope_book_id AS bookId
    `).get(lockToken) as { ownerId: number | null; total: number; processed: number; success: number; empty: number; fail: number; mode: string; bookId: number | null } | undefined;
    if (!row) return null;
    if (!row.ownerId) throw new Error("재고 작업 요청 사용자가 없습니다.");
    recordStockRefreshRun();
    return { ...row, ownerId: row.ownerId, lockToken };
  }).immediate();
}

function updateProgress(lockToken: string, values: { processed: number; success: number; empty: number; fail: number; total: number; message: string }): void {
  const percent = values.total <= 0 ? 0 : Math.min(100, Math.round(values.processed * 100 / values.total));
  const result = sqlite.prepare(`
    UPDATE stock_refresh_job SET processed = ?, success = ?, empty = ?, fail = ?, percent = ?,
      message = ?, updated_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?
  `).run(values.processed, values.success, values.empty, values.fail, percent, values.message, lockToken);
  if (result.changes !== 1) throw new LostStockJobError();
  recordStockRefreshRun();
}

class LostStockJobError extends Error {
  constructor() { super("재고 작업 소유권을 잃었습니다."); this.name = "LostStockJobError"; }
}

function assertRunningJob(lockToken: string): void {
  if (!sqlite.prepare("SELECT 1 FROM stock_refresh_job WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?").get(lockToken)) {
    throw new LostStockJobError();
  }
}

function saveStocks(lockToken: string, ownerId: number, target: RefreshTarget, stocks: AladinBranchStock[], bookScoped: boolean): boolean {
  const transaction = sqlite.transaction(() => {
    assertRunningJob(lockToken);
    const current = sqlite.prepare(`SELECT bv.id, bv.book AS bookId, bv.link, b.name AS bookName, bv.volume AS seq, COALESCE(NULLIF(bv.isbn13,''),bv.isbn) AS isbn13, bv.name
      FROM book_volumes bv JOIN books b ON b.id=bv.book
      WHERE bv.id=? AND b.owner_id=? AND COALESCE(bv.ispurchased,0)=0 AND COALESCE(bv.noneedtobuy,0)=0`)
      .get(target.id, ownerId) as RefreshTarget | undefined;
    if (!current || current.isbn13 !== target.isbn13 || (bookScoped && current.bookId !== target.bookId)) return false;
    target = current;
    sqlite.prepare(`DELETE FROM branchbook WHERE book_volume_id=? OR (book_volume_id IS NULL AND book=? AND volume=?
      AND 1=(SELECT COUNT(*) FROM book_volumes WHERE book=? AND volume=?))`).run(target.id, target.bookId, target.seq, target.bookId, target.seq);
    const insert = sqlite.prepare(`
      INSERT INTO branchbook(booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book, book_volume_id, systemmodstamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const offers = uniqueStocks(target.id, stocks);
    for (const stock of offers) {
      insert.run(stock.bookLink, stock.purchaseLink, stock.branch, stockIdentity(target.id, stock), target.seq ?? 0,
        target.name ?? stock.title ?? "", stock.price, stock.branchName, stock.grade, target.bookId, target.id);
    }
    recordStockRefreshResult(lockToken, ownerId, target, stocks.length
      ? { status: "SUCCESS", code: "STOCK_FOUND", message: `재고 ${offers.length}건을 확인했습니다.` }
      : { status: "EMPTY", code: "NO_STOCK", message: "조회에 성공했으며 현재 재고가 없습니다." });
    return true;
  });
  return transaction.immediate();
}

function recordFailure(lockToken: string, ownerId: number, target: RefreshTarget, code: string, message: string): void {
  sqlite.transaction(() => {
    assertRunningJob(lockToken);
    recordStockRefreshResult(lockToken, ownerId, target, { status: "FAILED", code, message });
  }).immediate();
}

function completeJob(lockToken: string, total: number, processed: number, success: number, empty: number, fail: number, bookScoped: boolean): void {
  sqlite.transaction(() => {
    assertRunningJob(lockToken);
    rebuildSummaryStatements(sqlite);
    sqlite.prepare(`
      UPDATE stock_refresh_job SET running = 0, completed = 1, failed = 0, status = 'COMPLETED',
        processed = ?, success = ?, empty = ?, fail = ?, percent = 100,
        message = ?, updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP,
        heartbeat_at = CURRENT_TIMESTAMP, lock_token = NULL
      WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?
    `).run(processed, success, empty, fail,
      `${bookScoped ? "책 재고 검색 완료" : "재고 일괄 조회 완료"}: 총 ${total}권 중 ${success}권 성공, ${empty}권 재고없음, ${fail}권 실패`, lockToken);
    rememberStockCompletion();
  }).immediate();
}

function failJob(lockToken: string, total: number, processed: number, success: number, empty: number, fail: number, message: string): void {
  sqlite.transaction(() => {
    assertRunningJob(lockToken);
    rebuildSummaryStatements(sqlite);
    const percent = total <= 0 ? 0 : Math.min(100, Math.round(processed * 100 / total));
    sqlite.prepare(`
      UPDATE stock_refresh_job SET running = 0, completed = 0, failed = 1, status = 'FAILED',
        processed = ?, success = ?, empty = ?, fail = ?, percent = ?, message = ?,
        updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP,
        heartbeat_at = CURRENT_TIMESTAMP, lock_token = NULL
      WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?
    `).run(processed, success, empty, fail, percent, message, lockToken);
    rememberStockCompletion();
  }).immediate();
}

export async function processNextStockRefreshJob(): Promise<boolean> {
  const claimed = claimStockJob();
  if (!claimed) return false;
  let { processed, success, empty, fail } = claimed;
  let total = claimed.total;
  try {
    if (!["REPLACE_ALL", "APPEND_BOOK", "REFRESH_SELECTED"].includes(claimed.mode)) throw new AppError("알 수 없는 재고 작업입니다.");
    const bookScoped = claimed.mode === "APPEND_BOOK";
    if (bookScoped) assertScopedBook(claimed.ownerId, claimed.bookId);
    const targets = sqlite.prepare(`
      SELECT bv.id, bv.book AS bookId, bv.link, b.name AS bookName, bv.volume AS seq, COALESCE(NULLIF(bv.isbn13,''),bv.isbn) AS isbn13, bv.name
      FROM book_volumes bv JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ? AND COALESCE(bv.ispurchased, 0) = 0 AND COALESCE(bv.noneedtobuy, 0) = 0
        AND (? IS NULL OR b.id = ?)
        AND EXISTS (SELECT 1 FROM stock_refresh_job_target t WHERE t.job_id=1 AND t.volume_id=bv.id)
      ORDER BY bv.id ASC
    `).all(claimed.ownerId, bookScoped ? claimed.bookId : null, bookScoped ? claimed.bookId : null) as RefreshTarget[];
    total = processed + targets.length;
    sqlite.transaction(() => {
      assertRunningJob(claimed.lockToken);
      sqlite.prepare("UPDATE stock_refresh_job SET total=? WHERE id=1 AND lock_token=? AND status='RUNNING'").run(total, claimed.lockToken);
      recordStockRefreshRun();
    }).immediate();

    const refreshTarget = async (target: RefreshTarget) => {
      assertRunningJob(claimed.lockToken);
      let code = "", reason = "";
      let stocks: AladinBranchStock[] = [];
      let rateLimit: AladinRateLimitError | undefined;
      if (!target.isbn13) {
        code = "ISBN_MISSING"; reason = "ISBN이 없어 재고를 조회할 수 없습니다. 권 정보에 ISBN을 입력해 주세요.";
      } else if (!isbn13Schema.safeParse(target.isbn13).success) {
        code = "ISBN_INVALID"; reason = "ISBN 형식이 올바르지 않습니다. 10자리 또는 13자리 ISBN을 확인해 주세요.";
      } else {
        try {
          const lookup = await inventoryRequestCheck.run(() => assertRunningJob(claimed.lockToken),
            lookupUsedStocks, target.isbn13, undefined, "inventory", target.link, claimed.ownerId);
          if (!lookup.successful) {
            if (lookup.errorCode === "ALADIN_RATE_LIMIT" || /429|호출 제한/.test(lookup.errorMessage)) throw new AladinRateLimitError(lookup.errorMessage);
            code = lookup.errorCode ?? "ALADIN_LOOKUP_FAILED"; reason = lookup.errorMessage;
          } else if (lookup.partial || lookup.stocks.some(stock => stock.verified === false)) {
            code = "STOCK_INCOMPLETE"; reason = "지점 재고의 가격·등급 또는 상세 정보를 확인하지 못했습니다. 잠시 후 다시 갱신해 주세요.";
          } else stocks = lookup.stocks;
        } catch (error) {
          if (error instanceof AladinRateLimitError) rateLimit = error;
          code = error instanceof AppError ? error.code : "STOCK_INTERNAL_ERROR";
          reason = error instanceof AppError ? error.message : "재고 조회 중 내부 오류가 발생했습니다. 잠시 후 재시도해 주세요.";
        }
      }
      // Fence the result, remaining targets and counters in the same commit as pause/resume.
      sqlite.transaction(() => {
        assertRunningJob(claimed.lockToken);
        if (!code && !saveStocks(claimed.lockToken, claimed.ownerId, target, stocks, bookScoped)) {
          code = "TARGET_CHANGED"; reason = "조회 중 권 정보나 구매 상태가 변경되어 결과를 저장하지 않았습니다.";
        }
        if (code) recordFailure(claimed.lockToken, claimed.ownerId, target, code, reason);
        sqlite.prepare("DELETE FROM stock_refresh_job_target WHERE job_id=1 AND volume_id=?").run(target.id);
        updateProgress(claimed.lockToken, {
          processed: processed + 1, success: success + Number(!code && stocks.length > 0),
          empty: empty + Number(!code && !stocks.length), fail: fail + Number(Boolean(code)), total,
          message: `${bookScoped ? "이 책의 재고를 검색 중입니다." : "중고 재고를 갱신 중입니다."} (${processed + 1}/${total})`
        });
      }).immediate();
      processed++;
      if (code) fail++;
      else if (stocks.length) success++;
      else empty++;
      if (rateLimit) throw rateLimit;
    };
    let next = 0;
    let stopped = false;
    let stopReason: unknown;
    async function consume() {
      while (!stopped && next < targets.length) {
        const target = targets[next++]!;
        try { await refreshTarget(target); }
        catch (error) {
          if (!stopped) { stopped = true; stopReason = error; }
        }
      }
    }
    // Drain in-flight lookups before finalizing the job. Late results remain fenced
    // by the same lock token after cancellation or replacement with another run.
    await Promise.all(Array.from({length: Math.min(STOCK_REFRESH_CONCURRENCY, targets.length)}, () => consume()));
    if (stopped) throw stopReason;
    completeJob(claimed.lockToken, total, processed, success, empty, fail, bookScoped);
  } catch (error) {
    if (error instanceof LostStockJobError) {
      logger.warn("Stopped a superseded stock worker without writing results");
      return true;
    }
    const message = error instanceof AladinRateLimitError
      ? "알라딘 API 호출 제한(429)이 계속되어 갱신을 중단했습니다. 잠시 후 다시 실행해 주세요."
      : error instanceof AppError
        ? error.message
        : "일괄 갱신 중 내부 오류가 발생했습니다. 서버 로그를 확인해 주세요.";
    try { failJob(claimed.lockToken, total, processed, success, empty, fail, message); }
    catch (failure) {
      if (!(failure instanceof LostStockJobError)) throw failure;
    }
    logger.error("Stock refresh failed", { ownerId: claimed.ownerId, error: String(error) });
  }
  return true;
}
