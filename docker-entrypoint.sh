#!/bin/sh
set -eu

chown -R bookshelf:bookshelf /app /data || true

if [ ! -w /data ]; then
  echo "오류: /data 디렉터리에 쓰기 권한이 없습니다. 호스트 볼륨 권한을 확인하세요." >&2
  exit 1
fi

exec su-exec bookshelf:bookshelf java -jar /app/app.jar "$@"
