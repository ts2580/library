#!/usr/bin/env bash
set -euo pipefail

db_path="${1:-data/bookshelf.sqlite}"
admin_username="trstyq"

if [[ ! -f "$db_path" ]]; then
  echo "DB 파일을 찾을 수 없습니다: $db_path" >&2
  exit 1
fi

if [[ "$db_path" == *"'"* ]]; then
  echo "작은따옴표가 포함된 DB 경로는 지원하지 않습니다." >&2
  exit 1
fi

admin_id="$(sqlite3 -readonly "$db_path" "SELECT id FROM member WHERE username = '$admin_username' LIMIT 1;")"
if [[ -z "$admin_id" ]]; then
  echo "$admin_username 계정을 찾을 수 없어 중단합니다." >&2
  exit 1
fi

backup_path="${db_path}.$(date +%Y%m%d%H%M%S).bak"
sqlite3 "$db_path" ".backup '$backup_path'"

owner_column_count="$(sqlite3 -readonly "$db_path" "SELECT COUNT(*) FROM pragma_table_info('books') WHERE name = 'owner_id';")"
if [[ "$owner_column_count" == "0" ]]; then
  sqlite3 "$db_path" "PRAGMA foreign_keys=ON; ALTER TABLE books ADD COLUMN owner_id INTEGER REFERENCES member(id) ON DELETE RESTRICT ON UPDATE CASCADE;"
fi

inventory_column_count="$(sqlite3 -readonly "$db_path" "SELECT COUNT(*) FROM pragma_table_info('branchbook') WHERE name = 'book_volume_id';")"
if [[ "$inventory_column_count" == "0" ]]; then
  sqlite3 "$db_path" "PRAGMA foreign_keys=ON; ALTER TABLE branchbook ADD COLUMN book_volume_id INTEGER REFERENCES book_volumes(id) ON DELETE CASCADE ON UPDATE CASCADE;"
fi

conflicting_count="$(sqlite3 -readonly "$db_path" "SELECT COUNT(*) FROM books WHERE owner_id IS NOT NULL AND owner_id <> $admin_id;")"
if [[ "$conflicting_count" != "0" ]]; then
  echo "다른 사용자에게 할당된 책이 ${conflicting_count}권 있어 중단합니다. 백업: $backup_path" >&2
  exit 1
fi

sqlite3 -bail "$db_path" <<SQL
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_books_owner_id ON books(owner_id);
CREATE INDEX IF NOT EXISTS idx_branchbook_book_volume_id ON branchbook(book_volume_id);
DROP INDEX IF EXISTS ux_book_volumes_isbn13_not_blank;
UPDATE books SET owner_id = $admin_id WHERE owner_id IS NULL;

CREATE TEMP TABLE _book_volume_map (branchbook_id INTEGER PRIMARY KEY, book_volume_id INTEGER NOT NULL);
INSERT INTO _book_volume_map (branchbook_id, book_volume_id)
SELECT bb.id, MIN(bv.id)
FROM branchbook bb
JOIN book_volumes bv ON bv.book = bb.book AND bv.volume = bb.volume
WHERE bb.book_volume_id IS NULL
GROUP BY bb.id
HAVING COUNT(bv.id) = 1;

INSERT OR IGNORE INTO _book_volume_map (branchbook_id, book_volume_id)
SELECT bb.id, MIN(bv.id)
FROM branchbook bb
JOIN book_volumes bv ON bv.book = bb.book AND bv.volume = bb.volume
WHERE bb.book_volume_id IS NULL
  AND TRIM(COALESCE(bb.name, '')) = TRIM(COALESCE(bv.name, ''))
GROUP BY bb.id
HAVING COUNT(bv.id) = 1;

WITH cover_parts AS (
    SELECT id, book, volume,
           substr(after_product, 1, instr(after_product, '/') - 1) AS product_group,
           substr(after_first, 1, instr(after_first, '/') - 1) AS product_subgroup
    FROM (
        SELECT id, book, volume, after_product,
               substr(after_product, instr(after_product, '/') + 1) AS after_first
        FROM (
            SELECT id, book, volume,
                   substr(cover, instr(lower(cover), '/product/') + 9) AS after_product
            FROM book_volumes
            WHERE instr(lower(COALESCE(cover, '')), '/product/') > 0
        )
    )
), product_matches AS (
    SELECT bb.id AS branchbook_id, MIN(cp.id) AS book_volume_id, COUNT(cp.id) AS match_count
    FROM branchbook bb
    JOIN cover_parts cp ON cp.book = bb.book AND cp.volume = bb.volume
    WHERE bb.book_volume_id IS NULL
      AND instr(COALESCE(bb.booklink, '') || ' ' || COALESCE(bb.purchaseurl, ''),
                'ItemId=' || cp.product_group || cp.product_subgroup) > 0
    GROUP BY bb.id
)
INSERT OR IGNORE INTO _book_volume_map (branchbook_id, book_volume_id)
SELECT branchbook_id, book_volume_id FROM product_matches WHERE match_count = 1;

CREATE TEMP TABLE _migration_assert (value INTEGER CHECK (value = 0));
INSERT INTO _migration_assert
SELECT COUNT(*)
FROM branchbook bb
LEFT JOIN _book_volume_map m ON m.branchbook_id = bb.id
WHERE bb.book_volume_id IS NULL AND m.branchbook_id IS NULL;

UPDATE branchbook
SET book_volume_id = (SELECT m.book_volume_id FROM _book_volume_map m WHERE m.branchbook_id = branchbook.id)
WHERE book_volume_id IS NULL;
COMMIT;
SQL

remaining_count="$(sqlite3 -readonly "$db_path" "SELECT COUNT(*) FROM books WHERE owner_id IS NULL OR owner_id <> $admin_id;")"
if [[ "$remaining_count" != "0" ]]; then
  echo "검증 실패: 소유권이 올바르지 않은 책이 ${remaining_count}권 남았습니다. 백업: $backup_path" >&2
  exit 1
fi

unresolved_inventory_count="$(sqlite3 -readonly "$db_path" "SELECT COUNT(*) FROM branchbook WHERE book_volume_id IS NULL;")"
if [[ "$unresolved_inventory_count" != "0" ]]; then
  echo "검증 실패: 권차 ID에 연결되지 않은 지점 재고가 ${unresolved_inventory_count}건 남았습니다. 백업: $backup_path" >&2
  exit 1
fi

total_count="$(sqlite3 -readonly "$db_path" "SELECT COUNT(*) FROM books;")"
echo "완료: ${total_count}권의 소유자는 $admin_username(id=$admin_id)입니다."
echo "백업: $backup_path"
