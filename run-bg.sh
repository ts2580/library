#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f .env ]]; then
  while IFS= read -r env_line; do
    [[ -z "$env_line" || "${env_line:0:1}" == "#" ]] && continue
    key="${env_line%%=*}"
    if [[ -n "$key" ]] && [[ -z "${!key+x}" ]]; then
      export "$env_line"
    fi
  done < .env
fi

ACTION="${1:-}"
if [[ -z "${ACTION}" ]]; then
  echo "Usage: ./run-bg.sh <start|stop|restart|status|logs> [run.sh args]"
  exit 1
fi
shift || true

PORT="${SERVER_PORT:-25647}"
RUN_SH="${SCRIPT_DIR}/run.sh"
PID_FILE="${BOOKSHELF_PID_FILE:-${SCRIPT_DIR}/.bookshelf.pid}"
LOG_FILE="${BOOKSHELF_LOG_FILE:-${SCRIPT_DIR}/.bookshelf.log}"

usage() {
  cat <<'USAGE'
Usage:
  ./run-bg.sh <start|stop|restart|status|logs> [run.sh args]

Commands:
  start    Start bookshelf in background
  stop     Stop background process by pid file (and fallback to port)
  restart  Restart by stop then start
  status   Check process status
  logs     Tail log file

Options are passed to ./run.sh for start/restart (예: --dev, --skip-css).

Environment:
  BOOKSHELF_PID_FILE  Custom pid file path (default: .bookshelf.pid)
  BOOKSHELF_LOG_FILE  Custom log file path (default: .bookshelf.log)
  SERVER_PORT         Application port (default: 25647)
USAGE
}

if [[ "${ACTION}" == "help" || "${ACTION}" == "-h" || "${ACTION}" == "--help" ]]; then
  usage
  exit 0
fi

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local existing_pid
  existing_pid="$(cat "$PID_FILE")"
  [[ -n "$existing_pid" ]] || return 1
  if kill -0 "$existing_pid" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

find_pid_on_port() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :$PORT )" 2>/dev/null \
      | awk 'NR>1 {match($0,/pid=([0-9]+)/,a); if (a[1] != "") print a[1]}' \
      || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$PORT"/tcp 2>/dev/null || true
  else
    echo ""
  fi
}

wait_for_exit() {
  local pid="$1"
  local timeout_sec="${2:-12}"
  local elapsed=0
  while (( elapsed < timeout_sec )); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

start_app() {
  local run_args=("$@")
  if is_running; then
    echo "already running (pid: $(cat "$PID_FILE"))"
    return 0
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  : > "$LOG_FILE"

  echo "starting bookshelf in background..."
  if command -v setsid >/dev/null 2>&1; then
    nohup setsid -f "$RUN_SH" "${run_args[@]}" >>"$LOG_FILE" 2>&1 < /dev/null &
  else
    nohup "$RUN_SH" "${run_args[@]}" >>"$LOG_FILE" 2>&1 < /dev/null &
  fi
  local launcher_pid=$!
  local app_pid=""
  local tries=0
  while (( tries < 20 )); do
    app_pid="$(find_pid_on_port)"
    if [[ -n "$app_pid" ]]; then
      break
    fi
    sleep 1
    tries=$((tries + 1))
  done

  if [[ -n "$app_pid" ]]; then
    echo "$app_pid" > "$PID_FILE"
    echo "started with pid $app_pid"
  else
    echo "$launcher_pid" > "$PID_FILE"
    echo "started with bootstrap pid $launcher_pid (application pid not detected yet)"
  fi
  echo "log: $LOG_FILE"
}

stop_app() {
  local stopped=0
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "stopping pid: $pid"
    kill "$pid" 2>/dev/null || true
    if wait_for_exit "$pid" 10; then
      echo "stopped pid $pid"
      stopped=1
    else
      echo "force kill pid $pid"
      kill -9 "$pid" 2>/dev/null || true
      if wait_for_exit "$pid" 4; then
        echo "stopped pid $pid"
        stopped=1
      fi
    fi
  fi

  local port_pids
  port_pids="$(find_pid_on_port)"
  if [[ -n "$port_pids" ]]; then
    for p in $port_pids; do
      if [[ -f "$PID_FILE" ]] && [[ "$(cat "$PID_FILE")" == "$p" ]]; then
        continue
      fi
      echo "found process on port $PORT: $p -> terminating"
      kill "$p" 2>/dev/null || true
      stopped=1
    done
  fi

  rm -f "$PID_FILE"
  if (( stopped == 0 )); then
    echo "no running bookshelf process found"
  fi
}

show_status() {
  if is_running; then
    echo "running (pid: $(cat "$PID_FILE"))"
    return 0
  fi

  local port_pids
  port_pids="$(find_pid_on_port)"
  if [[ -n "$port_pids" ]]; then
    local first_port_pid
    first_port_pid="$(printf '%s' "$port_pids" | awk 'NR==1 {print $1}')"
    echo "running (port: $PORT, pid: $first_port_pid)"
    echo "$first_port_pid" > "$PID_FILE"
    return 0
  fi

  echo "not running"
  return 1
}

show_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "log not found: $LOG_FILE"
    return 1
  fi
  tail -n 120 "$LOG_FILE"
}

case "${ACTION}" in
  start)
    start_app "$@"
    ;;
  stop)
    stop_app
    ;;
  restart)
    ARGS=("$@")
    stop_app
    start_app "${ARGS[@]}"
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  *)
    usage
    exit 1
    ;;
esac
