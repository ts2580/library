import "server-only";
import { sqlite } from "@/db";
import type { BranchInventoryItem, BranchStockItem, StockRefreshProgress } from "@/features/inventory/types";
import { escapeLike } from "@/lib/strings";

export function searchInventory(ownerId: number, input: { query?: string; branch?: string; page?: number }) {
  const query = input.query?.normalize("NFC").trim().slice(0, 200) ?? "";
  const where = ["b.owner_id = ?"];
  const args: Array<string | number> = [ownerId];
  if (input.branch) { where.push("bb.branch = ?"); args.push(input.branch); }
  if (query) {
    where.push(`(normalize_nfc(COALESCE(bv.name, bb.name, b.name)) LIKE ? ESCAPE '!'
      OR normalize_nfc(bb.name) LIKE ? ESCAPE '!' OR normalize_nfc(b.name) LIKE ? ESCAPE '!' OR bv.isbn13 LIKE ? ESCAPE '!'
      OR normalize_nfc(bb.branchname) LIKE ? ESCAPE '!' OR normalize_nfc(bb.branch) LIKE ? ESCAPE '!')`);
    args.push(...Array<string>(6).fill(`%${escapeLike(query)}%`));
  }
  const from = `FROM branchbook bb JOIN books b ON b.id = bb.book
    LEFT JOIN book_volumes bv ON bv.book = bb.book AND (
      bv.id = bb.book_volume_id OR (bb.book_volume_id IS NULL AND bv.id = (
        SELECT MIN(candidate.id) FROM book_volumes candidate
        WHERE candidate.book = bb.book AND candidate.volume = bb.volume HAVING COUNT(*) = 1
      ))
    ) WHERE ${where.join(" AND ")}`;
  const total = (sqlite.prepare(`SELECT COUNT(*) AS count ${from}`).get(...args) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(total / 24));
  const page = Math.min(totalPages, Math.max(1, Math.floor(input.page || 1)));
  const items = sqlite.prepare(`SELECT bb.id, bb.branch,
    COALESCE(NULLIF(TRIM(bb.branchname), ''), bb.branch) AS branchName,
    b.id AS bookId, b.name AS bookName, COALESCE(bv.name, bb.name) AS volumeName,
    bb.grade, bv.isbn13, bv.cover, bb.price, bb.booklink AS bookLink, bb.purchaseurl AS purchaseUrl
    ${from} ORDER BY bb.id DESC LIMIT 24 OFFSET ?`).all(...args, (page - 1) * 24) as BranchStockItem[];
  return { items, total, page, totalPages, query };
}

export function getStockRefreshProgress(ownerId: number): StockRefreshProgress {
  const row = sqlite.prepare(`
    SELECT running, completed, failed, total, processed, success, empty, fail, percent,
           COALESCE(message, '') AS message, updated_at AS updatedAt, status,
           requested_by AS requestedBy
    FROM stock_refresh_job
    WHERE id = 1
  `).get() as Record<string, unknown> | undefined;
  if (!row) {
    return { running: false, completed: false, failed: false, total: 0, processed: 0, success: 0, empty: 0, fail: 0, percent: 0, message: "아직 실행한 작업이 없습니다.", updatedAt: null, status: "IDLE" };
  }
  const status = row.status as StockRefreshProgress["status"];
  const requestedBy = row.requestedBy == null ? null : Number(row.requestedBy);
  if (requestedBy != null && requestedBy !== ownerId) {
    if (status === "QUEUED" || status === "RUNNING") {
      return {
        running: true, completed: false, failed: false, total: 0, processed: 0, success: 0,
        empty: 0, fail: 0, percent: 0,
        message: "다른 계정의 재고 갱신 작업이 진행 중입니다.",
        updatedAt: row.updatedAt ? String(row.updatedAt) : null, status
      };
    }
    return { running: false, completed: false, failed: false, total: 0, processed: 0, success: 0, empty: 0, fail: 0, percent: 0, message: "아직 실행한 작업이 없습니다.", updatedAt: null, status: "IDLE" };
  }
  return {
    running: Boolean(row.running), completed: Boolean(row.completed), failed: Boolean(row.failed),
    total: Number(row.total), processed: Number(row.processed), success: Number(row.success),
    empty: Number(row.empty), fail: Number(row.fail), percent: Number(row.percent),
    message: String(row.message), updatedAt: row.updatedAt ? String(row.updatedAt) : null, status
  };
}

export function getBranchInventory(ownerId: number): BranchInventoryItem[] {
  return sqlite.prepare(`
    SELECT
      COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN') AS branch,
      MAX(COALESCE(NULLIF(NULLIF(TRIM(bb.branchname), ''), 'branchname'), NULLIF(bb.branch, ''), '지점')) AS branchName,
      COUNT(*) AS stockCount,
      SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END) AS pricedCount,
      SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bb.price, ',', '') AS INTEGER) ELSE 0 END) AS totalAmount
    FROM branchbook bb
    JOIN books b ON b.id = bb.book
    WHERE b.owner_id = ?
    GROUP BY branch
    ORDER BY totalAmount DESC, stockCount DESC, branchName ASC
  `).all(ownerId).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      branch: String(item.branch), branchName: String(item.branchName),
      stockCount: Number(item.stockCount), pricedCount: Number(item.pricedCount), totalAmount: Number(item.totalAmount)
    };
  });
}

export function getBranchStocks(ownerId: number, branch: string): BranchStockItem[] {
  return sqlite.prepare(`
    SELECT bb.id, bb.branch, NULLIF(NULLIF(TRIM(bb.branchname), ''), 'branchname') AS branchName,
           b.id AS bookId, b.name AS bookName, COALESCE(bv.name, bb.name) AS volumeName,
           bb.grade, bv.isbn13, bv.cover, bb.price, bb.booklink AS bookLink, bb.purchaseurl AS purchaseUrl
    FROM branchbook bb
    JOIN books b ON b.id = bb.book AND b.owner_id = ?
    LEFT JOIN book_volumes bv
      ON bv.id = bb.book_volume_id
      OR (
        bb.book_volume_id IS NULL
        AND bv.id = (
          SELECT MIN(candidate.id)
          FROM book_volumes candidate
          WHERE candidate.book = bb.book
            AND candidate.volume = bb.volume
          HAVING COUNT(*) = 1
        )
      )
    WHERE bb.branch = ?
    ORDER BY COALESCE(NULLIF(bb.grade, ''), 'ZZZ'), COALESCE(bv.name, bb.name) COLLATE NOCASE
  `).all(ownerId, branch) as BranchStockItem[];
}
