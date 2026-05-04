#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-./bookshelf.sqlite}"

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

echo "migrated sqlite verification passed: $DB_PATH"
for table in "${required_tables[@]}"; do
  count="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM \"$table\";")"
  echo "$table=$count"
done
