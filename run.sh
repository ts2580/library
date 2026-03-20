#!/usr/bin/env bash
set -euo pipefail

# Root helper: run bookshelf Spring Boot app in foreground
# Usage:
#   ./run.sh          # load .env, handle port conflict, run bootRun
#   ./run.sh --dev    # load .env, compileJava check, handle port conflict, run bootRun

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f .env ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | xargs)
fi

PORT="${SERVER_PORT:-25647}"

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

release_port

if [[ "${1:-}" == "--dev" ]]; then
  echo "[run] Starting in dev mode with compileJava first..."
  ./gradlew compileJava --no-daemon
fi

echo "[run] Starting Bookshelf on port $PORT"
./gradlew bootRun --no-daemon
