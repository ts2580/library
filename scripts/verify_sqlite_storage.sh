#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${1:-/tmp/bookshelf-sqlite-storage-verify.sqlite}"

rm -f "$DB_PATH"

sqlite3 -batch "$DB_PATH" <<SQL
.read ${ROOT_DIR}/src/main/resources/schema.sql
INSERT INTO member (id, username, password_hash) VALUES (1, 'owner-a', 'hash'), (2, 'owner-b', 'hash');
INSERT INTO books (id, name, author, description, totalvolume, type, cover, createddate, owner_id)
VALUES (1, '테스트 책', '테스터', '설명', '1', '만화', 'cover', CURRENT_TIMESTAMP, 1),
       (2, '다른 사용자 책', '테스터', '설명', '1', '만화', 'cover', CURRENT_TIMESTAMP, 2);

INSERT INTO book_volumes (id, book, isbn13, name, cover, price, ispurchased, volume, createddate)
VALUES (1, 1, '9781234567890', '테스트 책 1권', 'cover', '10,000', 0, 1, CURRENT_TIMESTAMP);
INSERT INTO book_volumes (id, book, isbn13, name, cover, price, ispurchased, volume, createddate)
VALUES (2, 2, '9781234567890', '다른 사용자 책 1권', 'cover', '10,000', 0, 1, CURRENT_TIMESTAMP);

INSERT INTO branchbook (booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book, book_volume_id)
VALUES ('link', 'buy', 'B1', 'uuid-1', 1, '테스트 책', '9,000', '강남점', 'A', 1, 1)
ON CONFLICT(uuid) DO UPDATE SET
    price = excluded.price,
    purchaseurl = excluded.purchaseurl,
    name = excluded.name,
    branchname = excluded.branchname,
    grade = excluded.grade,
    volume = excluded.volume;

DELETE FROM branch_inventory_summary;
INSERT INTO branch_inventory_summary (branch, branch_name, stock_count, priced_count, total_amount, updated_at)
SELECT
    COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN'),
    COALESCE(NULLIF(bb.branchname, ''), COALESCE(NULLIF(bb.branch, ''), '지점')),
    COUNT(*),
    SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END),
    SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bb.price, ',', '') AS INTEGER) ELSE 0 END),
    CURRENT_TIMESTAMP
FROM branchbook bb
GROUP BY
    COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN'),
    COALESCE(NULLIF(bb.branchname, ''), COALESCE(NULLIF(bb.branch, ''), '지점'))
HAVING COUNT(*) > 0;
SQL

book_matches="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM books WHERE name LIKE '%테스트%' OR author LIKE '%테스트%';")"
summary="$(sqlite3 "$DB_PATH" "SELECT branch || '|' || branch_name || '|' || stock_count || '|' || priced_count || '|' || total_amount FROM branch_inventory_summary;")"
fk_errors="$(sqlite3 "$DB_PATH" "PRAGMA foreign_key_check;")"
shared_isbn_owners="$(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT b.owner_id) FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE bv.isbn13 = '9781234567890';")"
stable_join_rows="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM branchbook bb JOIN book_volumes bv ON bv.id = bb.book_volume_id;")"
global_isbn_index="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'ux_book_volumes_isbn13_not_blank';")"

if [[ "$book_matches" != "1" ]]; then
  echo "Expected one matching book, got: $book_matches" >&2
  exit 1
fi

if [[ "$summary" != "B1|강남점|1|1|9000" ]]; then
  echo "Unexpected branch inventory summary: $summary" >&2
  exit 1
fi

if [[ "$shared_isbn_owners" != "2" || "$global_isbn_index" != "0" ]]; then
  echo "Expected the same ISBN to be allowed for two different owners." >&2
  exit 1
fi

if [[ "$stable_join_rows" != "1" ]]; then
  echo "Expected branch inventory to join through book_volume_id." >&2
  exit 1
fi

if [[ -n "$fk_errors" ]]; then
  echo "Foreign key check failed:" >&2
  echo "$fk_errors" >&2
  exit 1
fi

echo "sqlite storage verification passed: $DB_PATH"
