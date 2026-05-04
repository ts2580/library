#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_OUT="${1:-/tmp/bookshelf-javac-main}"
TEST_OUT="${2:-/tmp/bookshelf-javac-test}"
JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/}javac"

if ! command -v "$JAVA_BIN" >/dev/null 2>&1; then
  echo "javac not found. Set JAVA_HOME or add javac to PATH." >&2
  exit 1
fi

if [[ ! -d "$HOME/.gradle/caches/modules-2/files-2.1" ]]; then
  echo "Gradle dependency cache not found at ~/.gradle/caches/modules-2/files-2.1." >&2
  exit 1
fi

CLASSPATH="$(find "$HOME/.gradle/caches/modules-2/files-2.1" \
  -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' \
  2>/dev/null | paste -sd ':' -)"

if [[ -z "$CLASSPATH" ]]; then
  echo "No dependency jars found in the local Gradle cache." >&2
  exit 1
fi

MAIN_SOURCES="$(mktemp /tmp/bookshelf-main-sources.XXXXXX)"
TEST_SOURCES="$(mktemp /tmp/bookshelf-test-sources.XXXXXX)"
trap 'rm -f "$MAIN_SOURCES" "$TEST_SOURCES"' EXIT

find "$ROOT_DIR/src/main/java" -name '*.java' | sort > "$MAIN_SOURCES"
find "$ROOT_DIR/src/test/java" -name '*.java' | sort > "$TEST_SOURCES"

rm -rf "$MAIN_OUT" "$TEST_OUT"
mkdir -p "$MAIN_OUT" "$TEST_OUT"

"$JAVA_BIN" -encoding UTF-8 -cp "$CLASSPATH" -d "$MAIN_OUT" @"$MAIN_SOURCES"
"$JAVA_BIN" -encoding UTF-8 -cp "$MAIN_OUT:$CLASSPATH" -d "$TEST_OUT" @"$TEST_SOURCES"

echo "java source compile verification passed: $MAIN_OUT $TEST_OUT"
