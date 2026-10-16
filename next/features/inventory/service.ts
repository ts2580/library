import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sqlite } from "@/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AladinRateLimitError, isAladinConfigured } from "@/features/aladin/client";
import { lookupUsedStocks } from "@/features/aladin/service";
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

export function requestStockRefresh(ownerId: number): { started: boolean; message: string } {
  if (!isAladinConfigured()) throw new AppError("ALADIN_TTB_KEY가 설정되어 있지 않습니다.");
  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ? AND COALESCE(bv.ispurchased, 0) = 0 AND COALESCE(bv.noneedtobuy, 0) = 0
  `).get(ownerId) as { count: number }).count;
  const result = sqlite.prepare(`
    UPDATE stock_refresh_job SET
      running = 1, completed = 0, failed = 0, total = ?, processed = 0,
      success = 0, empty = 0, fail = 0, percent = 0,
      message = '중고 재고 일괄 갱신 대기 중입니다.', updated_at = CURRENT_TIMESTAMP,
      status = 'QUEUED', requested_by = ?, lock_token = NULL,
      started_at = NULL, finished_at = NULL, heartbeat_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND status NOT IN ('QUEUED', 'RUNNING')
  `).run(total, ownerId);
  if (result.changes !== 1) return { started: false, message: "이미 재고 갱신이 진행 중입니다." };
  return { started: true, message: "재고 갱신 작업을 등록했습니다." };
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
        status = 'IDLE', requested_by = ?, lock_token = NULL, finished_at = CURRENT_TIMESTAMP
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

function claimStockJob(): { ownerId: number; total: number; lockToken: string } | null {
  const lockToken = randomUUID();
  const result = sqlite.prepare(`
    UPDATE stock_refresh_job SET status = 'RUNNING', running = 1, lock_token = ?,
      started_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
      message = '재고 초기화를 준비 중입니다.'
    WHERE id = 1 AND status = 'QUEUED'
  `).run(lockToken);
  if (result.changes !== 1) return null;
  const row = sqlite.prepare("SELECT requested_by AS ownerId, total FROM stock_refresh_job WHERE id = 1 AND lock_token = ?").get(lockToken) as { ownerId: number | null; total: number };
  if (!row.ownerId) throw new Error("재고 작업 요청 사용자가 없습니다.");
  return { ownerId: row.ownerId, total: row.total, lockToken };
}

function updateProgress(lockToken: string, values: { processed: number; success: number; empty: number; fail: number; total: number; message: string }): void {
  const percent = values.total <= 0 ? 0 : Math.min(100, Math.round(values.processed * 100 / values.total));
  sqlite.prepare(`
    UPDATE stock_refresh_job SET processed = ?, success = ?, empty = ?, fail = ?, percent = ?,
      message = ?, updated_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND lock_token = ?
  `).run(values.processed, values.success, values.empty, values.fail, percent, values.message, lockToken);
}

function stockUuid(target: RefreshTarget, stock: AladinBranchStock): string {
  return createHash("sha256").update([
    target.id, stock.branch, stock.branchName, stock.grade ?? "", target.seq ?? 0, stock.bookLink ?? ""
  ].join("|")).digest("hex");
}

function saveStocks(target: RefreshTarget, stocks: AladinBranchStock[]): void {
  const transaction = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM branchbook WHERE book_volume_id = ?")
      .run(target.id);
    const insert = sqlite.prepare(`
      INSERT INTO branchbook(booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book, book_volume_id, systemmodstamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(uuid) DO UPDATE SET
        price = excluded.price, purchaseurl = excluded.purchaseurl, name = excluded.name,
        branchname = excluded.branchname, grade = excluded.grade,
        volume = excluded.volume, book_volume_id = excluded.book_volume_id,
        systemmodstamp = CURRENT_TIMESTAMP
    `);
    for (const stock of stocks) {
      insert.run(stock.bookLink, stock.purchaseLink, stock.branch, stockUuid(target, stock), target.seq ?? 0,
        target.name ?? stock.title ?? "", stock.price, stock.branchName, stock.grade, target.bookId, target.id);
    }
  });
  transaction.immediate();
}

function completeJob(lockToken: string, total: number, processed: number, success: number, empty: number, fail: number): void {
  rebuildSummary();
  sqlite.prepare(`
    UPDATE stock_refresh_job SET running = 0, completed = 1, failed = 0, status = 'COMPLETED',
      processed = ?, success = ?, empty = ?, fail = ?, percent = 100,
      message = ?, updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP,
      heartbeat_at = CURRENT_TIMESTAMP, lock_token = NULL
    WHERE id = 1 AND lock_token = ?
  `).run(processed, success, empty, fail,
    `재고 일괄 조회 완료: 총 ${total}권 중 ${success}권 성공, ${empty}권 재고없음, ${fail}권 실패`, lockToken);
}

function failJob(lockToken: string, total: number, processed: number, success: number, empty: number, fail: number, message: string): void {
  try { rebuildSummary(); } catch (error) { logger.error("Inventory summary rebuild failed", { error: String(error) }); }
  const percent = total <= 0 ? 0 : Math.min(100, Math.round(processed * 100 / total));
  sqlite.prepare(`
    UPDATE stock_refresh_job SET running = 0, completed = 0, failed = 1, status = 'FAILED',
      processed = ?, success = ?, empty = ?, fail = ?, percent = ?, message = ?,
      updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP,
      heartbeat_at = CURRENT_TIMESTAMP, lock_token = NULL
    WHERE id = 1 AND lock_token = ?
  `).run(processed, success, empty, fail, percent, message, lockToken);
}

export async function processNextStockRefreshJob(): Promise<boolean> {
  const claimed = claimStockJob();
  if (!claimed) return false;
  let processed = 0, success = 0, empty = 0, fail = 0;
  try {
    // A queued job can survive a restart with a different environment.
    if (!isAladinConfigured()) throw new AppError("ALADIN_TTB_KEY가 설정되어 있지 않습니다.");
    const clear = sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM branchbook WHERE book IN (SELECT id FROM books WHERE owner_id = ?)").run(claimed.ownerId);
      sqlite.prepare("DELETE FROM branch_inventory_summary").run();
    });
    clear.immediate();

    if (claimed.total === 0) {
      completeJob(claimed.lockToken, 0, 0, 0, 0, 0);
      return true;
    }

    const targets = sqlite.prepare(`
      SELECT bv.id, bv.book AS bookId, bv.volume AS seq, bv.isbn13, bv.name
      FROM book_volumes bv JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ? AND COALESCE(bv.ispurchased, 0) = 0 AND COALESCE(bv.noneedtobuy, 0) = 0
      ORDER BY bv.id ASC
    `).all(claimed.ownerId) as RefreshTarget[];

    for (const target of targets) {
      try {
        if (!target.isbn13) {
          fail += 1;
        } else {
          const lookup = await lookupUsedStocks(target.isbn13);
          if (!lookup.successful) {
            if (/429|호출 제한/.test(lookup.errorMessage)) throw new AladinRateLimitError(lookup.errorMessage);
            fail += 1;
          } else if (lookup.stocks.length === 0) {
            empty += 1;
          } else {
            saveStocks(target, lookup.stocks);
            success += 1;
          }
        }
      } catch (error) {
        fail += 1;
        if (error instanceof AladinRateLimitError) {
          processed += 1;
          updateProgress(claimed.lockToken, { processed, success, empty, fail, total: claimed.total, message: "API 호출 제한으로 중단 중입니다." });
          throw error;
        }
        logger.warn("Stock lookup failed", { volumeId: target.id, error: String(error) });
      }
      processed += 1;
      updateProgress(claimed.lockToken, {
        processed, success, empty, fail, total: claimed.total,
        message: `중고 재고를 갱신 중입니다. (${processed}/${claimed.total})`
      });
    }
    completeJob(claimed.lockToken, claimed.total, processed, success, empty, fail);
  } catch (error) {
    const message = error instanceof AladinRateLimitError
      ? "알라딘 API 호출 제한(429)이 계속되어 갱신을 중단했습니다. 잠시 후 다시 실행해 주세요."
      : error instanceof AppError
        ? error.message
        : "일괄 갱신 중 내부 오류가 발생했습니다. 서버 로그를 확인해 주세요.";
    failJob(claimed.lockToken, claimed.total, processed, success, empty, fail, message);
    logger.error("Stock refresh failed", { ownerId: claimed.ownerId, error: String(error) });
  }
  return true;
}
