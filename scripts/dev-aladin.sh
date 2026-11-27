#!/usr/bin/env bash
# The dev runner owns this process group. FD 3 signals that the app can start.
set -eu -o pipefail
umask 077
: "${ALADIN_BROWSER_OWNER:?Set ALADIN_BROWSER_OWNER in .env}"
: "${ALADIN_BROWSER_VNC_PASSWORD:?Set ALADIN_BROWSER_VNC_PASSWORD in .env}"
web_dir=${NOVNC_WEB_DIR:-/usr/share/novnc}
bind_ip=${ALADIN_BROWSER_BIND_IP:-127.0.0.1}
port=${ALADIN_BROWSER_VNC_PORT:-7900}
for tool in java curl Xtigervnc tigervncpasswd xauth mcookie websockify; do
  command -v "$tool" >/dev/null || { echo "[dev] $tool 설치가 필요합니다. README의 로컬 실행 절차를 확인하세요." >&2; exit 1; }
done
[[ -r "$web_dir/vnc.html" ]] || { echo "[dev] noVNC를 찾을 수 없습니다: $web_dir/vnc.html" >&2; exit 1; }
[[ $port =~ ^[0-9]{1,5}$ ]] && ((10#$port >= 1 && 10#$port <= 65535)) || { echo "[dev] noVNC 포트 범위는 1~65535입니다." >&2; exit 1; }
if (echo > /dev/tcp/127.0.0.1/4444) 2>/dev/null; then
  echo "[dev] 로컬 WebDriver 포트 4444가 이미 사용 중입니다." >&2
  exit 1
fi

runtime=$(mktemp -d)
download=
cleanup() {
  rm -rf -- "$runtime"
  if [[ -n $download ]]; then rm -f -- "$download"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

version=4.54.0
sha=db1f7498474c00abb467116a832c0e08a99127896c0873dc414c0a0a30419c74
cache=${XDG_CACHE_HOME:-$HOME/.cache}/bookshelf
jar=$cache/selenium-server-$version.jar
mkdir -p "$cache"
if ! printf '%s  %s\n' "$sha" "$jar" | sha256sum --check --status 2>/dev/null; then
  echo "[dev] Selenium $version 다운로드 중"
  download=$(mktemp "$cache/selenium.XXXXXXXX")
  curl --fail --silent --show-error --location --retry 2 -o "$download" \
    "https://github.com/SeleniumHQ/selenium/releases/download/selenium-$version/selenium-server-$version.jar"
  printf '%s  %s\n' "$sha" "$download" | sha256sum --check --status
  mv -f -- "$download" "$jar"
  download=
fi

printf '%s\n' "$ALADIN_BROWSER_VNC_PASSWORD" | tigervncpasswd -f > "$runtime/passwd"
unset ALADIN_BROWSER_VNC_PASSWORD
export XAUTHORITY="$runtime/Xauthority"
touch "$XAUTHORITY"
cookie=$(mcookie)
printf 'add :0 . %s\n' "$cookie" | xauth -q
Xtigervnc -displayfd 4 -auth "$XAUTHORITY" -nolisten tcp -geometry 1440x900 -depth 24 \
  -rfbport -1 -rfbunixpath "$runtime/rfb.sock" -SecurityTypes VncAuth \
  -PasswordFile "$runtime/passwd" 4>"$runtime/display" &
desktop=$!
for ((i=0; i<100; i++)); do
  [[ -s "$runtime/display" ]] && break
  kill -0 "$desktop" && sleep 0.1 || exit 1
done
read -r number < "$runtime/display"
export DISPLAY=:$number
printf 'add %s . %s\n' "$DISPLAY" "$cookie" | xauth -q

websockify --web "$web_dir" --unix-target "$runtime/rfb.sock" "$bind_ip:$port" &
# Minimal LXCs may keep Firefox's GTK libraries in a user-local directory.
if [[ -d "$HOME/.local/lib/bookshelf-firefox" ]]; then
  export LD_LIBRARY_PATH="$HOME/.local/lib/bookshelf-firefox${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
java -jar "$jar" standalone --host 127.0.0.1 --port 4444 --tracing false \
  --detect-drivers false --max-sessions 1 --session-timeout 86400 --session-request-timeout 180 \
  --driver-configuration display-name=Firefox max-sessions=1 'stereotype={"browserName":"firefox"}' &

# Warm up Selenium Manager before the application's shorter request timeout starts.
warmup() {
  local driver=$ALADIN_BROWSER_URL session
  for ((i=0; i<100; i++)); do
    if curl --noproxy '*' -fs --max-time 1 "$driver/status" -o /dev/null; then break; fi
    sleep 0.2
  done
  local web_host=$bind_ip
  if [[ $web_host == *:* ]]; then web_host="[$bind_ip]"; fi
  curl --noproxy '*' -fsS --max-time 5 "http://$web_host:$port/vnc.html" -o /dev/null
  echo "[dev] Firefox와 geckodriver를 준비합니다. 첫 실행에는 다운로드가 필요할 수 있습니다."
  session=$(curl --noproxy '*' --fail-with-body -sS --max-time 190 -H 'Content-Type: application/json; charset=utf-8' \
    -d '{"capabilities":{"alwaysMatch":{"browserName":"firefox","moz:firefoxOptions":{}}}}' "$driver/session" |
    node -pe 'const v = JSON.parse(require("fs").readFileSync(0)).value; if (!v.sessionId) throw Error(v.message); v.sessionId')
  curl --noproxy '*' -fsS --max-time 10 -X DELETE "$driver/session/$session" -o /dev/null
  echo "[dev] 알라딘 브라우저 준비 완료 (noVNC $bind_ip:$port)"
  printf 'ready\n' >&3
}
warmup &
startup=$!
# A failed service must also stop the web and worker via the parent supervisor.
wait -n -p finished
if [[ $finished != "$startup" ]]; then exit 1; fi
wait -n
exit 1
