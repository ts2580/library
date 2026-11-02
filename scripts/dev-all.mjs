import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
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
  console.log("[dev] 웹과 워커를 종료합니다.");
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

for (const [name, args] of [
  ["웹", ["node_modules/next/dist/bin/next", "dev", "--port", process.env.PORT || "25647"]],
  ["워커", ["--conditions=react-server", "--import", "tsx", "--watch", "worker/worker.ts"]]
]) {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit", detached: !windows });
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
}
console.log("[dev] 웹과 워커를 함께 시작합니다. 종료: Ctrl+C");
