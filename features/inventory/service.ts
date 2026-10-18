import "server-only";
import { randomUUID } from "node:crypto";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AladinRateLimitError, isAladinConfigured } from "@/features/aladin/client";
import { lookupUsedStocks } from "@/features/aladin/service";
import { stockIdentity, uniqueStocks } from "@/features/inventory/stock-identity";
import type { AladinBranchStock } from "@/features/aladin/types";

interface RefreshTarget {
  id: number;
  bookId: number;
  seq: number | null;
  isbn13: string | null;
  name: string | null;
}

function rebuildSummaryStatements(): void {
  sqlite.prepare("DELETE FROM branch_inventory_summary").run();
  sqlite.prepare(`
    INSERT INTO branch_inventory_summary(branch, branch_name, stock_count, priced_count, total_amount, updated_at)
    SELECT
      COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN'),
      MAX(COALESCE(NULLIF(NULLIF(TRIM(bb.branchname), ''), 'branchname'), NULLIF(bb.branch, ''), '지점')),
      COUNT(*),
      SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END),
      SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bb.price, ',', '') AS INTEGER) ELSE 0 END),
      CURRENT_TIMESTAMP
    FROM branchbook bb
    GROUP BY 1
    HAVING COUNT(*) > 0
  `).run();
}

function rebuildSummary(): void {
  sqlite.transaction(rebuildSummaryStatements).immediate();
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

function queueStockJob(ownerId: number, bookId: number | null): { started: boolean; message: string } {
  return sqlite.transaction(() => {
    if (bookId != null) assertScopedBook(ownerId, bookId);
    if (!isAladinConfigured()) throw new AppError("ALADIN_TTB_KEY가 설정되어 있지 않습니다.");
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
      WHERE id = 1 AND status NOT IN ('QUEUED', 'RUNNING')
    `).run(total, bookId == null ? "중고 재고 일괄 갱신 대기 중입니다." : "이 책의 재고 검색을 기다리고 있습니다. 기존 재고는 유지합니다.",
      bookId == null ? "REPLACE_ALL" : "APPEND_BOOK", bookId, ownerId, randomUUID());
    if (result.changes !== 1) return { started: false, message: "이미 재고 갱신이 진행 중입니다." };
    return { started: true, message: "재고 갱신 작업을 등록했습니다." };
  }).immediate();
}

export function deleteOwnerInventory(ownerId: number): void {
  const transaction = sqlite.transaction(() => {
    const active = sqlite.prepare("SELECT status FROM stock_refresh_job WHERE id = 1").get() as { status: string };
    if (["QUEUED", "RUNNING"].includes(active.status)) {
      throw new AppError("재고 갱신 중에는 저장 재고를 삭제할 수 없습니다.", "JOB_ACTIVE", 409);
    }
    sqlite.prepare("DELETE FROM branchbook WHERE book IN (SELECT id FROM books WHERE owner_id = ?)").run(ownerId);
    rebuildSummaryStatements();
    sqlite.prepare(`
      UPDATE stock_refresh_job SET running = 0, completed = 0, failed = 0, total = 0,
        processed = 0, success = 0, empty = 0, fail = 0, percent = 0,
        message = '지점 재고를 삭제했습니다.', updated_at = CURRENT_TIMESTAMP,
        status = 'IDLE', requested_by = ?, run_id = NULL, lock_token = NULL, finished_at = CURRENT_TIMESTAMP,
        mode = 'REPLACE_ALL', scope_book_id = NULL
      WHERE id = 1
    `).run(ownerId);
  });
  transaction.immediate();
}

export function recoverInterruptedStockJob(): void {
  const row = sqlite.prepare("SELECT status FROM stock_refresh_job WHERE id = 1").get() as { status: string };
  if (row.status !== "RUNNING") return;
  rebuildSummary();
  sqlite.prepare(`
    UPDATE stock_refresh_job SET running = 0, failed = 1, completed = 0, status = 'FAILED',
      message = '워커 재기동으로 이전 재고 갱신 작업이 중단되었습니다. 다시 실행해 주세요.',
      updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP, lock_token = NULL
    WHERE id = 1
  `).run();
}

function claimStockJob(): { ownerId: number; total: number; lockToken: string; mode: string; bookId: number | null } | null {
  const lockToken = randomUUID();
  const result = sqlite.prepare(`
    UPDATE stock_refresh_job SET status = 'RUNNING', running = 1, lock_token = ?,
      started_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
      message = CASE WHEN mode='APPEND_BOOK' THEN '이 책의 재고 검색을 준비 중입니다.' ELSE '재고 초기화를 준비 중입니다.' END
    WHERE id = 1 AND status = 'QUEUED'
  `).run(lockToken);
  if (result.changes !== 1) return null;
  const row = sqlite.prepare("SELECT requested_by AS ownerId, total, mode, scope_book_id AS bookId FROM stock_refresh_job WHERE id = 1 AND lock_token = ?")
    .get(lockToken) as { ownerId: number | null; total: number; mode: string; bookId: number | null };
  if (!row.ownerId) throw new Error("재고 작업 요청 사용자가 없습니다.");
  return { ownerId: row.ownerId, total: row.total, lockToken, mode: row.mode, bookId: row.bookId };
}

function updateProgress(lockToken: string, values: { processed: number; success: number; empty: number; fail: number; total: number; message: string }): void {
  const percent = values.total <= 0 ? 0 : Math.min(100, Math.round(values.processed * 100 / values.total));
  const result = sqlite.prepare(`
    UPDATE stock_refresh_job SET processed = ?, success = ?, empty = ?, fail = ?, percent = ?,
      message = ?, updated_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?
  `).run(values.processed, values.success, values.empty, values.fail, percent, values.message, lockToken);
  if (result.changes !== 1) throw new LostStockJobError();
}

class LostStockJobError extends Error {
  constructor() { super("재고 작업 소유권을 잃었습니다."); this.name = "LostStockJobError"; }
}

function assertRunningJob(lockToken: string): void {
  if (!sqlite.prepare("SELECT 1 FROM stock_refresh_job WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?").get(lockToken)) {
    throw new LostStockJobError();
  }
}

function saveStocks(lockToken: string, ownerId: number, target: RefreshTarget, stocks: AladinBranchStock[], append: boolean): boolean {
  const transaction = sqlite.transaction(() => {
    assertRunningJob(lockToken);
    const current = sqlite.prepare(`SELECT bv.id, bv.book AS bookId, bv.volume AS seq, bv.isbn13, bv.name
      FROM book_volumes bv JOIN books b ON b.id=bv.book
      WHERE bv.id=? AND b.owner_id=? AND COALESCE(bv.ispurchased,0)=0 AND COALESCE(bv.noneedtobuy,0)=0`)
      .get(target.id, ownerId) as RefreshTarget | undefined;
    if (!current || current.isbn13 !== target.isbn13 || (append && current.bookId !== target.bookId)) return false;
    target = current;
    const existing = append ? sqlite.prepare(`SELECT COALESCE(branch,'') AS branch,grade,booklink AS bookLink,purchaseurl AS purchaseLink
      FROM branchbook WHERE book_volume_id=? OR (book_volume_id IS NULL AND book=? AND volume=?
        AND 1=(SELECT COUNT(*) FROM book_volumes WHERE book=? AND volume=?))`)
      .all(target.id, target.bookId, target.seq, target.bookId, target.seq) as Array<Pick<AladinBranchStock, "branch" | "grade" | "bookLink" | "purchaseLink">> : [];
    const existingKeys = new Set(existing.map(stock => stockIdentity(target.id, stock)));
    if (!append) sqlite.prepare("DELETE FROM branchbook WHERE book_volume_id = ?").run(target.id);
    const insert = sqlite.prepare(`
      INSERT INTO branchbook(booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book, book_volume_id, systemmodstamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(uuid) ${append ? "DO NOTHING" : `DO UPDATE SET
        price = excluded.price, purchaseurl = excluded.purchaseurl, name = excluded.name,
        branchname = excluded.branchname, grade = excluded.grade,
        volume = excluded.volume, book_volume_id = excluded.book_volume_id,
        systemmodstamp = CURRENT_TIMESTAMP`}
    `);
    for (const stock of uniqueStocks(target.id, stocks)) {
      if (existingKeys.has(stockIdentity(target.id, stock))) continue;
      insert.run(stock.bookLink, stock.purchaseLink, stock.branch, stockIdentity(target.id, stock), target.seq ?? 0,
        target.name ?? stock.title ?? "", stock.price, stock.branchName, stock.grade, target.bookId, target.id);
    }
    return true;
  });
  return transaction.immediate();
}

function completeJob(lockToken: string, total: number, processed: number, success: number, empty: number, fail: number, append: boolean): void {
  sqlite.transaction(() => {
    assertRunningJob(lockToken);
    rebuildSummaryStatements();
    sqlite.prepare(`
      UPDATE stock_refresh_job SET running = 0, completed = 1, failed = 0, status = 'COMPLETED',
        processed = ?, success = ?, empty = ?, fail = ?, percent = 100,
        message = ?, updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP,
        heartbeat_at = CURRENT_TIMESTAMP, lock_token = NULL
      WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?
    `).run(processed, success, empty, fail,
      `${append ? "책 재고 검색 완료" : "재고 일괄 조회 완료"}: 총 ${total}권 중 ${success}권 성공, ${empty}권 재고없음, ${fail}권 실패`, lockToken);
  }).immediate();
}

function failJob(lockToken: string, total: number, processed: number, success: number, empty: number, fail: number, message: string): void {
  sqlite.transaction(() => {
    assertRunningJob(lockToken);
    rebuildSummaryStatements();
    const percent = total <= 0 ? 0 : Math.min(100, Math.round(processed * 100 / total));
    sqlite.prepare(`
      UPDATE stock_refresh_job SET running = 0, completed = 0, failed = 1, status = 'FAILED',
        processed = ?, success = ?, empty = ?, fail = ?, percent = ?, message = ?,
        updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP,
        heartbeat_at = CURRENT_TIMESTAMP, lock_token = NULL
      WHERE id = 1 AND status = 'RUNNING' AND lock_token = ?
    `).run(processed, success, empty, fail, percent, message, lockToken);
  }).immediate();
}

export async function processNextStockRefreshJob(): Promise<boolean> {
  const claimed = claimStockJob();
  if (!claimed) return false;
  let processed = 0, success = 0, empty = 0, fail = 0;
  let total = claimed.total;
  try {
    // A queued job can survive a restart with a different environment.
    if (!isAladinConfigured()) throw new AppError("ALADIN_TTB_KEY가 설정되어 있지 않습니다.");
    if (!["REPLACE_ALL", "APPEND_BOOK"].includes(claimed.mode)) throw new AppError("알 수 없는 재고 작업입니다.");
    const append = claimed.mode === "APPEND_BOOK";
    if (append) assertScopedBook(claimed.ownerId, claimed.bookId);
    const clear = sqlite.transaction(() => {
      assertRunningJob(claimed.lockToken);
      sqlite.prepare("DELETE FROM branchbook WHERE book IN (SELECT id FROM books WHERE owner_id = ?)").run(claimed.ownerId);
      sqlite.prepare("DELETE FROM branch_inventory_summary").run();
    });
    if (!append) clear.immediate();

    const targets = sqlite.prepare(`
      SELECT bv.id, bv.book AS bookId, bv.volume AS seq, bv.isbn13, bv.name
      FROM book_volumes bv JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ? AND COALESCE(bv.ispurchased, 0) = 0 AND COALESCE(bv.noneedtobuy, 0) = 0
        AND (? IS NULL OR b.id = ?)
      ORDER BY bv.id ASC
    `).all(claimed.ownerId, append ? claimed.bookId : null, append ? claimed.bookId : null) as RefreshTarget[];
    total = targets.length;
    sqlite.prepare("UPDATE stock_refresh_job SET total=? WHERE id=1 AND lock_token=? AND status='RUNNING'").run(total, claimed.lockToken);

    for (const target of targets) {
      assertRunningJob(claimed.lockToken);
      try {
        if (!target.isbn13) {
          fail += 1;
        } else {
          const lookup = await lookupUsedStocks(target.isbn13);
          assertRunningJob(claimed.lockToken);
          if (!lookup.successful) {
            if (/429|호출 제한/.test(lookup.errorMessage)) throw new AladinRateLimitError(lookup.errorMessage);
            fail += 1;
          } else if (lookup.partial || lookup.stocks.some((stock) => stock.verified === false)) {
            // Branch existence is not proof of individual prices or available offers.
            fail += 1;
            logger.warn("Incomplete branch inventory was not saved", { volumeId: target.id });
          } else if (lookup.stocks.length === 0) {
            empty += 1;
          } else {
            if (saveStocks(claimed.lockToken, claimed.ownerId, target, lookup.stocks, append)) success += 1;
            else fail += 1;
          }
        }
      } catch (error) {
        if (error instanceof LostStockJobError) throw error;
        fail += 1;
        if (error instanceof AladinRateLimitError) {
          processed += 1;
          updateProgress(claimed.lockToken, { processed, success, empty, fail, total, message: "API 호출 제한으로 중단 중입니다." });
          throw error;
        }
        logger.warn("Stock lookup failed", { volumeId: target.id, error: String(error) });
      }
      processed += 1;
      updateProgress(claimed.lockToken, {
        processed, success, empty, fail, total,
        message: `${append ? "이 책의 재고를 검색 중입니다." : "중고 재고를 갱신 중입니다."} (${processed}/${total})`
      });
    }
    completeJob(claimed.lockToken, total, processed, success, empty, fail, append);
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
