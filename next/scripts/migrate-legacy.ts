// Started only by the authenticated Spring migration endpoint. No HTTP input is
// interpreted as a command, path, environment setting, or executable argument.
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { prepareHandover } from "@/features/migration/handover";
import { waitForChildExit } from "@/features/migration/processes";

async function main() {
  const cwd = process.cwd();
  const destination = path.resolve(required("NEXT_HANDOVER_DESTINATION"));
  const migrationRoot = path.join(cwd, "data", "migrations");
  if (path.dirname(destination) !== migrationRoot || !/^handover-[a-f0-9-]+$/.test(path.basename(destination))) throw new Error("잘못된 이전 디렉터리입니다.");
  const statusFile = path.join(destination, "progress.json");
  await fs.mkdir(destination, { recursive: true });
  let activated = process.env.NEXT_HANDOVER_RESUME === "true";
  let report: unknown;
  async function progress(phase: string, percent: number, message: string) {
    const content = JSON.stringify({ phase, percent, message, activated, report });
    await fs.writeFile(statusFile + ".tmp", content, { mode: 0o600 });
    await fs.rename(statusFile + ".tmp", statusFile);
  }
  process.env.BOOKSHELF_DB_PATH = path.join(destination, "bookshelf.sqlite");
  process.env.BOOKSHELF_DATA_DIR = destination;
  process.env.BOOKSHELF_LEGACY_OWNER_USERNAME = required("NEXT_HANDOVER_OWNER");
  process.env.BOOKSHELF_AUTO_BACKUP = "true";
  process.env.REGISTRATION = "false";
  Object.assign(process.env, { NODE_ENV: "production" });
  const port = Number(process.env.NEXT_HANDOVER_PORT ?? "25648");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("잘못된 Next 포트입니다.");
  const children: ChildProcess[] = [];
  const childExits: Promise<void>[] = [];
  let stopping = false;
  const stop = () => { stopping = true; for (const child of children) if (child.exitCode === null) child.kill("SIGTERM"); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  try {
    await progress("CHECKING", 5, "새 앱 실행 환경을 확인하고 있습니다.");
    await fs.access(path.join(cwd, ".next", "BUILD_ID"));
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer(); server.once("error", () => reject(new Error(`새 앱 포트 ${port}가 이미 사용 중입니다.`)));
      server.listen(port, "0.0.0.0", () => server.close((error) => error ? reject(error) : resolve()));
    });
    if (!activated) {
      // Resolve runtime env only after the destination is selected.
      const { bootstrapDatabase } = await import("@/db/bootstrap");
      report = await prepareHandover({ sourceDatabase: required("NEXT_HANDOVER_SOURCE_DB"), sourceCovers: required("NEXT_HANDOVER_SOURCE_COVERS"), destination, owner: required("NEXT_HANDOVER_OWNER"), progress, bootstrap: bootstrapDatabase });
      await fs.writeFile(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    } else {
      report = JSON.parse(await fs.readFile(path.join(destination, "report.json"), "utf8"));
    }
    await progress("STARTING", 85, "검사가 끝났습니다. Next.js 웹과 워커를 시작합니다.");
    const pointer = path.join(cwd, "data", "active-migration.json");
    if (!activated) {
      // Exclusive creation prevents silently replacing an already adopted DB.
      await fs.writeFile(pointer, JSON.stringify({ version: 1, dataDir: path.relative(cwd, destination) }, null, 2), { flag: "wx", mode: 0o600 });
      activated = true;
      // Persist before any new application process can accept writes.
      await progress("STARTING", 90, "새 데이터 경로를 적용했습니다. 새 앱을 시작합니다.");
    }
    function launch(args: string[]) {
      const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: "inherit" });
      children.push(child);
      child.on("error", () => stop());
      childExits.push(waitForChildExit(child));
      return child;
    }
    launch(["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "0.0.0.0"]);
    launch(["--conditions=react-server", "--import", "tsx", "worker/worker.ts"]);
    let healthy = false;
    for (let i = 0; i < 90 && !stopping; i++) {
      if (children.some((child) => child.exitCode !== null || child.signalCode !== null)) throw new Error("새 웹 또는 워커가 시작 중 종료되었습니다.");
      try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
      if (healthy) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!healthy || stopping) throw new Error("새 앱의 시작을 확인하지 못했습니다.");
    if (children.some((child) => child.exitCode !== null || child.signalCode !== null)) throw new Error("새 웹 또는 워커가 시작 중 종료되었습니다.");
    await progress("COMPLETED", 100, "이전이 완료되었습니다. 기존 계정으로 새 책장에 로그인하세요.");
    await Promise.race(childExits);
    stop();
    await progress("INTERRUPTED", 100, "새 앱이 종료되었습니다. 이전된 데이터로 다시 시작할 수 있습니다.");
  } catch (error) {
    stop();
    await progress(activated ? "INTERRUPTED" : "FAILED", 0, error instanceof Error ? error.message : "이전 중 오류가 발생했습니다.");
    process.exitCode = 1;
  } finally {
    stop();
    await Promise.all(children.map((child) => new Promise<void>((resolve) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    })));
  }
}
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} 설정이 없습니다.`); return value; }
main().catch((error) => { console.error(error instanceof Error ? error.message : "이전을 시작하지 못했습니다."); process.exitCode = 1; });
