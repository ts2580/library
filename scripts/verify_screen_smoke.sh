#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${BOOKSHELF_BASE_URL:-http://localhost:25647}}"
DB_PATH="${2:-${BOOKSHELF_DB_PATH:-${SQLITE_DB_PATH:-./bookshelf.sqlite}}}"
USERNAME="${BOOKSHELF_SMOKE_USERNAME:-bookshelf_smoke_$$}"
PASSWORD="${BOOKSHELF_SMOKE_PASSWORD:-bookshelf-smoke}"
BRANCH_CODE="${BOOKSHELF_SMOKE_BRANCH:-SMOKE_$$}"
SMOKE_MARKER="bookshelf-screen-smoke-fixture-$$"
BOOK_ID=""
COOKIE_JAR="$(mktemp /tmp/bookshelf-screen-cookie.XXXXXX)"
LOGIN_BODY="$(mktemp /tmp/bookshelf-login-body.XXXXXX)"
BODY="$(mktemp /tmp/bookshelf-screen-body.XXXXXX)"

cleanup() {
  if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DB_PATH" ]]; then
    sqlite3 "$DB_PATH" <<SQL || true
PRAGMA foreign_keys = ON;
DELETE FROM branch_inventory_summary WHERE branch = '$BRANCH_CODE';
DELETE FROM branchbook WHERE uuid = '$SMOKE_MARKER';
DELETE FROM book_volumes WHERE book IN (SELECT id FROM books WHERE description = '$SMOKE_MARKER');
DELETE FROM books WHERE description = '$SMOKE_MARKER';
DELETE FROM member WHERE username = '$USERNAME' AND description = '$SMOKE_MARKER';
SQL
  fi
  rm -f "$COOKIE_JAR" "$LOGIN_BODY" "$BODY"
}
trap cleanup EXIT

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for screen smoke verification." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for CSRF token extraction." >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DB_PATH" ]]; then
  sqlite3 "$DB_PATH" <<SQL
PRAGMA foreign_keys = ON;

INSERT INTO member (username, password_hash, email, name, description)
VALUES (
  '$USERNAME',
  '\$2a\$10\$OeySFFqCk4TT6PvrSiGh.esTKzZ6O.JRcBZF.o.QAp2iib1Ga95T6',
  'bookshelf-smoke@example.invalid',
  'Bookshelf Smoke',
  '$SMOKE_MARKER'
)
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  email = excluded.email,
  name = excluded.name,
  description = excluded.description;

DELETE FROM branch_inventory_summary WHERE branch = '$BRANCH_CODE';
DELETE FROM branchbook WHERE uuid = '$SMOKE_MARKER';
DELETE FROM book_volumes WHERE book IN (SELECT id FROM books WHERE description = '$SMOKE_MARKER');
DELETE FROM books WHERE description = '$SMOKE_MARKER';

INSERT INTO books (name, author, description, totalvolume, type, cover, createddate)
VALUES ('SQLite Smoke Book', 'SQLite Smoke Author', '$SMOKE_MARKER', '1', 'Smoke', '', CURRENT_TIMESTAMP);
SQL

  BOOK_ID="$(sqlite3 "$DB_PATH" "SELECT id FROM books WHERE description = '$SMOKE_MARKER' ORDER BY id DESC LIMIT 1;")"
  if [[ -z "$BOOK_ID" ]]; then
    echo "Failed to seed smoke book fixture." >&2
    exit 1
  fi

  sqlite3 "$DB_PATH" <<SQL
PRAGMA foreign_keys = ON;

INSERT INTO book_volumes (book, isbn13, name, cover, price, ispurchased, volume, createddate)
VALUES ($BOOK_ID, '9780000000001', 'SQLite Smoke Book 1', '', '12,000', 0, 1, CURRENT_TIMESTAMP);

INSERT INTO branchbook (booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book)
VALUES ('https://example.invalid/book', 'https://example.invalid/buy', '$BRANCH_CODE', '$SMOKE_MARKER', 1, 'SQLite Smoke Book 1', '9,000', 'SQLite Smoke Branch', 'A', $BOOK_ID)
ON CONFLICT(uuid) DO UPDATE SET
  price = excluded.price,
  purchaseurl = excluded.purchaseurl,
  name = excluded.name,
  branchname = excluded.branchname,
  grade = excluded.grade,
  volume = excluded.volume,
  book = excluded.book;

DELETE FROM branch_inventory_summary WHERE branch = '$BRANCH_CODE';
INSERT INTO branch_inventory_summary (branch, branch_name, stock_count, priced_count, total_amount, updated_at)
SELECT
  COALESCE(NULLIF(branch, ''), 'UNKNOWN'),
  COALESCE(NULLIF(branchname, ''), COALESCE(NULLIF(branch, ''), '지점')),
  COUNT(*),
  SUM(CASE WHEN REPLACE(COALESCE(price, ''), ',', '') <> '' AND REPLACE(price, ',', '') NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END),
  SUM(CASE WHEN REPLACE(COALESCE(price, ''), ',', '') <> '' AND REPLACE(price, ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(price, ',', '') AS INTEGER) ELSE 0 END),
  CURRENT_TIMESTAMP
FROM branchbook
WHERE branch = '$BRANCH_CODE'
GROUP BY COALESCE(NULLIF(branch, ''), 'UNKNOWN'), COALESCE(NULLIF(branchname, ''), COALESCE(NULLIF(branch, ''), '지점'));
SQL
else
  echo "Skipping SQLite fixture seed; DB file not found or sqlite3 missing: $DB_PATH" >&2
fi

http_code="$(curl -sS -c "$COOKIE_JAR" -o "$LOGIN_BODY" -w '%{http_code}' "$BASE_URL/user/login")"
if [[ "$http_code" != "200" ]]; then
  echo "GET /user/login failed with HTTP $http_code" >&2
  exit 1
fi

csrf_pair="$(python3 - "$LOGIN_BODY" <<'PY'
import re
import sys

html = open(sys.argv[1], encoding='utf-8').read()
for tag in re.findall(r'<input\b[^>]*>', html):
    if 'type="hidden"' not in tag and "type='hidden'" not in tag:
        continue
    name = re.search(r'\bname=["\']([^"\']+)["\']', tag)
    value = re.search(r'\bvalue=["\']([^"\']*)["\']', tag)
    if name and value:
        print(name.group(1) + "\t" + value.group(1))
        break
PY
)"

if [[ -z "$csrf_pair" ]]; then
  echo "Could not extract CSRF token from login page." >&2
  exit 1
fi

csrf_name="${csrf_pair%%$'\t'*}"
csrf_value="${csrf_pair#*$'\t'}"

login_code="$(curl -sS -L -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o "$BODY" -w '%{http_code}' \
  -X POST "$BASE_URL/user/login" \
  --data-urlencode "$csrf_name=$csrf_value" \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD")"

if [[ "$login_code" != "200" ]]; then
  echo "POST /user/login failed with HTTP $login_code" >&2
  exit 1
fi

if ! grep -Fq "Bookshelf 대시보드" "$BODY"; then
  echo "Login did not reach the dashboard. Check the smoke account and DB path." >&2
  exit 1
fi

check_page() {
  local path="$1"
  local expected="$2"
  local code

  code="$(curl -sS -L -b "$COOKIE_JAR" -o "$BODY" -w '%{http_code}' "$BASE_URL$path")"
  if [[ "$code" != "200" ]]; then
    echo "GET $path failed with HTTP $code" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$BODY"; then
    echo "GET $path did not contain expected text: $expected" >&2
    exit 1
  fi
  echo "screen ok: $path"
}

check_page "/dashboard" "Bookshelf 대시보드"
check_page "/books" "내 책장"
check_page "/books?search=SQLite" "SQLite Smoke Book"
check_page "/books/$BOOK_ID" "SQLite Smoke Book"
check_page "/products" "상품 검색"
check_page "/dashboard/branches" "SQLite Smoke Branch"
check_page "/dashboard/branches/$BRANCH_CODE" "SQLite Smoke Book"

echo "screen smoke verification passed: $BASE_URL"
