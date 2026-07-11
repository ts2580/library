#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-./data/bookshelf.sqlite}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "SQLite database not found: $DB_PATH" >&2
  exit 1
fi

required_tables=(
  books
  member
  book_volumes
  branchbook
  branch_inventory_summary
)

for table in "${required_tables[@]}"; do
  exists="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '$table';")"
  if [[ "$exists" != "1" ]]; then
    echo "Missing required table: $table" >&2
    exit 1
  fi
done

fk_errors="$(sqlite3 "$DB_PATH" "PRAGMA foreign_key_check;")"
if [[ -n "$fk_errors" ]]; then
  echo "Foreign key check failed:" >&2
  echo "$fk_errors" >&2
  exit 1
fi

owner_column="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('books') WHERE name = 'owner_id';")"
inventory_reference_column="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('branchbook') WHERE name = 'book_volume_id';")"
if [[ "$owner_column" != "1" || "$inventory_reference_column" != "1" ]]; then
  echo "Ownership migration columns are missing. Run scripts/migrate_book_ownership.sh first." >&2
  exit 1
fi

unowned_books="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM books WHERE owner_id IS NULL;")"
unresolved_inventory="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM branchbook WHERE book_volume_id IS NULL;")"
if [[ "$unowned_books" != "0" || "$unresolved_inventory" != "0" ]]; then
  echo "Ownership migration is incomplete: unowned_books=$unowned_books unresolved_inventory=$unresolved_inventory" >&2
  exit 1
fi

isbn_duplicates="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM (SELECT b.owner_id, bv.isbn13 FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE bv.isbn13 IS NOT NULL AND TRIM(bv.isbn13) <> '' GROUP BY b.owner_id, bv.isbn13 HAVING COUNT(*) > 1);")"
if [[ "$isbn_duplicates" != "0" ]]; then
  echo "Duplicate non-blank isbn13 values found within one owner: $isbn_duplicates" >&2
  exit 1
fi

inventory_rows="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM branchbook;")"
stable_join_rows="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM branchbook bb JOIN book_volumes bv ON bv.id = bb.book_volume_id;")"
if [[ "$inventory_rows" != "$stable_join_rows" ]]; then
  echo "Stable inventory join mismatch: branchbook=$inventory_rows joined=$stable_join_rows" >&2
  exit 1
fi

echo "migrated sqlite verification passed: $DB_PATH"
echo "unowned_books=$unowned_books"
echo "unresolved_inventory=$unresolved_inventory"
echo "stable_inventory_join_rows=$stable_join_rows"
for table in "${required_tables[@]}"; do
  count="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM \"$table\";")"
  echo "$table=$count"
done
