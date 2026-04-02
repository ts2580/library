#!/usr/bin/env bash
set -euo pipefail

# Root helper: run bookshelf Spring Boot app in foreground
# Usage:
#   ./run.sh                    # .env 로드 + Tailwind 빌드(기본) + 포트 충돌 정리 + foreground 실행
#   ./run.sh --dev              # .env 로드 + Tailwind 빌드 + compileJava 검증 + 포트 충돌 정리 + foreground 실행
#   ./run.sh --skip-css         # .env 로드 + CSS 빌드 완전 스킵 + 포트 충돌 정리 + foreground 실행
#   ./run.sh --dev --skip-css   # .env 로드 + CSS 빌드 스킵 + compileJava + 포트 충돌 정리 + foreground 실행

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f .env ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | xargs)
fi

PORT="${SERVER_PORT:-25647}"
RUN_DEV=0
SKIP_CSS=0

for arg in "$@"; do
  case "$arg" in
    --dev)
      RUN_DEV=1
      ;;
    --skip-css)
      SKIP_CSS=1
      ;;
  esac
done

release_port() {
  local pid_list
  pid_list=""

  if command -v lsof >/dev/null 2>&1; then
    pid_list="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
  elif command -v ss >/dev/null 2>&1; then
    pid_list="$(ss -ltnp "( sport = :$PORT )" 2>/dev/null | awk 'NR>1 {match($0,/pid=([0-9]+)/,a); if (a[1] != "") print a[1]}')"
  elif command -v fuser >/dev/null 2>&1; then
    pid_list="$(fuser "$PORT"/tcp 2>/dev/null || true)"
  fi

  if [[ -n "$pid_list" ]]; then
    echo "[run] Port $PORT is in use. Existing PIDs: $pid_list"
    for p in $pid_list; do
      if [[ -z "$p" ]]; then
        continue
      fi
      echo "[run] Stopping PID=$p"
      kill "$p" 2>/dev/null || true
    done

    sleep 1

    for p in $pid_list; do
      if kill -0 "$p" 2>/dev/null; then
        echo "[run] PID=$p did not stop. Force kill..."
        kill -9 "$p" 2>/dev/null || true
      fi
    done

    sleep 1
    echo "[run] Port $PORT is freed."
  else
    echo "[run] Port $PORT is free."
  fi
}

build_tailwind() {
  if [[ "$SKIP_CSS" == "1" ]]; then
    echo "[run] --skip-css enabled. Skip tailwind build."
    return
  fi

  if [[ ! -f "package.json" ]] || [[ ! -f "src/main/resources/static/css/blinko-tailwind-input.css" ]]; then
    echo "[run] Tailwind source not found. Skip css:build."
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "[run] npm not found. Skip tailwind build."
    return
  fi

  echo "[run] Building tailwind css..."
  if [[ -d node_modules ]] && [[ -d node_modules/tailwindcss ]] && [[ -f node_modules/tailwindcss/package.json ]]; then
    echo "[run] node_modules already installed. Skip npm install."
  else
    echo "[run] node_modules not found. Installing..."
    npm install --no-audit --no-fund
  fi
  npm run css:build
}

release_port
build_tailwind

if [[ "$RUN_DEV" == "1" ]]; then
  echo "[run] Starting in dev mode with compileJava first..."
  ./gradlew compileJava --no-daemon
fi

echo "[run] Starting Bookshelf on port $PORT"
./gradlew bootRun --no-daemon
