#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-/tmp/bookshelf-javac-repository-verify}"

find_jar() {
  local module_path="$1"
  find "$HOME/.gradle/caches/modules-2/files-2.1/$module_path" \
    -type f -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' \
    2>/dev/null | sort | tail -1
}

SPRING_JDBC_JAR="$(find_jar org.springframework/spring-jdbc)"
SPRING_TX_JAR="$(find_jar org.springframework/spring-tx)"
SPRING_BEANS_JAR="$(find_jar org.springframework/spring-beans)"
SPRING_CORE_JAR="$(find_jar org.springframework/spring-core)"
SPRING_CONTEXT_JAR="$(find_jar org.springframework/spring-context)"
SPRING_JCL_JAR="$(find_jar org.springframework/spring-jcl)"
SLF4J_API_JAR="$(find_jar org.slf4j/slf4j-api)"

for jar in "$SPRING_JDBC_JAR" "$SPRING_TX_JAR" "$SPRING_BEANS_JAR" "$SPRING_CORE_JAR" "$SPRING_CONTEXT_JAR" "$SPRING_JCL_JAR" "$SLF4J_API_JAR"; do
  if [[ -z "$jar" || ! -f "$jar" ]]; then
    echo "Required compile jar is missing from the local Gradle cache." >&2
    exit 1
  fi
done

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

CLASSPATH="$SPRING_JDBC_JAR:$SPRING_TX_JAR:$SPRING_BEANS_JAR:$SPRING_CORE_JAR:$SPRING_CONTEXT_JAR:$SPRING_JCL_JAR:$SLF4J_API_JAR"

javac -cp "$CLASSPATH" -d "$OUT_DIR" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/integration/aladin/AladinBranchStock.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/model/Book.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/model/BookVolume.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/model/BranchInventorySummary.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/model/BranchStockItem.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/repository/BookRowMappers.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/repository/BookDataRepository.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/repository/BookVolumeRepository.java" \
  "$ROOT_DIR/src/main/java/com/example/bookshelf/user/repository/BranchInventoryRepository.java"

echo "repository javac verification passed: $OUT_DIR"
