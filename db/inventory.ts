import type Database from "better-sqlite3";

export function rebuildSummaryStatements(sqlite: Database.Database): void {
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

export function resetQueuedInventory(sqlite: Database.Database, ownerId: number, bookId: number | null, selected: boolean) {
  if (selected) {
    sqlite.prepare(`DELETE FROM branchbook AS bb WHERE bb.book IN (SELECT id FROM books WHERE owner_id=?) AND (
      bb.book_volume_id IN (SELECT volume_id FROM stock_refresh_job_target WHERE job_id=1)
      OR (bb.book_volume_id IS NULL AND (
        SELECT MIN(v.id) FROM book_volumes v WHERE v.book=bb.book AND v.volume=bb.volume HAVING COUNT(*)=1
      ) IN (SELECT volume_id FROM stock_refresh_job_target WHERE job_id=1)))`).run(ownerId);
  } else {
    sqlite.prepare(`DELETE FROM branchbook WHERE book IN (
      SELECT id FROM books WHERE owner_id=? AND (? IS NULL OR id=?)
    )`).run(ownerId, bookId, bookId);
  }
  rebuildSummaryStatements(sqlite);
}
