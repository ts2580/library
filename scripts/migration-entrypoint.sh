#!/bin/sh
set -eu
mkdir -p /data /app/data /app/next/data /app/next/.next/cache
chown -R bookshelf:bookshelf /data /app/data /app/next/data /app/next/.next/cache
exec gosu bookshelf java -jar /app/app.jar "$@"
