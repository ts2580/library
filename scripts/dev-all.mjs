import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const withAladin = process.argv.includes("--aladin");
const children = [];
let stopping = false;

function signalTree(child, signal) {
  if (!child.pid) return;
  if (windows) {
    // Windows has no POSIX process groups; include Next/watch descendants.
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
      .on("error", error => console.error(`[dev] 종료 실패: ${error.message}`));
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") console.error(`[dev] 종료 실패: ${error.message}`); }
}

function groupAlive(child) {
  if (!child.pid) return false;
  if (windows) return child.exitCode === null && child.signalCode === null;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  console.log("[dev] 개발 프로세스를 종료합니다.");
  for (const { child } of children) signalTree(child, "SIGTERM");
  const poll = setInterval(() => {
    if (children.every(({ child }) => !groupAlive(child))) {
      clearInterval(poll);
      clearTimeout(force);
    }
  }, 100);
  const force = setTimeout(() => {
    for (const { child } of children) signalTree(child, "SIGKILL");
    clearInterval(poll);
  }, 5000);
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

function start(name, command, args, options = {}) {
  const child = spawn(command, args, { cwd, stdio: "inherit", detached: !windows, ...options });
  children.push({ child, name });
  child.on("error", error => {
    console.error(`[dev] ${name} 실행 실패: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[dev] ${name} 종료 (${signal ?? code}).`);
      stop(code ?? 1);
    }
  });
  return child;
}

function startApp() {
  start("웹", process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", process.env.PORT || "25647"]);
  start("워커", process.execPath, ["--conditions=react-server", "--import", "tsx", "--watch", "worker/worker.ts"]);
  console.log("[dev] 웹과 워커를 함께 시작합니다. 종료: Ctrl+C");
}

if (withAladin) {
  if (process.platform !== "linux") throw new Error("dev:aladin은 Linux 개발 환경에서 실행하세요.");
  const { default: nextEnv } = await import("@next/env");
  nextEnv.loadEnvConfig(cwd, true);
  process.env.PORT ||= process.env.SERVER_PORT || "25647";
  process.env.ALADIN_BROWSER_URL = "http://127.0.0.1:4444";
  // Selenium also interprets SERVER_PORT. Give the desktop only its own settings.
  const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(ALADIN_BROWSER_|LC_)/.test(key) ||
    ["HOME", "PATH", "LANG", "TMPDIR", "JAVA_HOME", "XDG_CACHE_HOME", "LD_LIBRARY_PATH", "PYTHONPATH", "NOVNC_WEB_DIR"].includes(key) ||
    /^(https?_proxy|no_proxy|all_proxy)$/i.test(key)
  ));
  const browser = start("알라딘 브라우저", "bash", ["scripts/dev-aladin.sh"], {
    env: browserEnv, stdio: ["inherit", "inherit", "inherit", "pipe"]
  });
  browser.stdio[3].once("data", () => {
    if (!stopping) startApp();
  });
} else {
  startApp();
}
