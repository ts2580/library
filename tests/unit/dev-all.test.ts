import { afterEach, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const fixtures: Array<{ directory: string; runner: ChildProcess }> = [];
const root = process.cwd();
function start() {
  const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-dev-all-"));
  for (const folder of ["scripts", "worker", "node_modules/next/dist/bin"]) mkdirSync(path.join(directory, folder), { recursive: true });
  copyFileSync(path.join(root, "scripts/dev-all.mjs"), path.join(directory, "scripts/dev-all.mjs"));
  symlinkSync(path.join(root, "node_modules/tsx"), path.join(directory, "node_modules/tsx"), "dir");
  const source = `
    const fs = require('node:fs');
    const {spawn} = require('node:child_process');
    const name = process.argv[1].includes('worker') ? 'worker' : 'web';
    const nested = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
    fs.writeFileSync(name+'.json', JSON.stringify({pid:process.pid,nested:nested.pid,args:process.argv,execArgv:process.execArgv}));
    process.on('SIGTERM',()=>{nested.kill();process.exit(0)});
    setInterval(()=>{if(name==='web' && fs.existsSync('fail'))process.exit(7)},20);
  `;
  writeFileSync(path.join(directory, "node_modules/next/dist/bin/next"), source);
  writeFileSync(path.join(directory, "worker/worker.ts"), source);
  const runner = spawn(process.execPath, [path.join(directory, "scripts/dev-all.mjs")], {
    cwd: tmpdir(), stdio: "ignore", env: { ...process.env, PORT: "25649" }
  });
  const exited = once(runner, "exit");
  fixtures.push({ directory, runner });
  return { directory, runner, exited };
}
function running(pid: number) {
  try {
    // A reparented zombie has stopped executing; its reaping is owned by init.
    if (process.platform === "linux" && readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z")) return false;
    process.kill(pid, 0); return true;
  } catch { return false; }
}
async function ready(directory: string) {
  await expect.poll(() => ["web", "worker"].every(name => existsSync(path.join(directory, `${name}.json`)))).toBe(true);
  return ["web", "worker"].map(name => JSON.parse(readFileSync(path.join(directory, `${name}.json`), "utf8")) as { pid: number; nested: number; args: string[]; execArgv: string[] });
}
afterEach(async () => {
  for (const { directory, runner } of fixtures.splice(0)) {
    if (runner.exitCode === null && runner.signalCode === null) {
      runner.kill("SIGTERM");
      await Promise.race([once(runner, "exit"), delay(6000)]);
    }
    for (const name of ["web", "worker"]) {
      const file = path.join(directory, `${name}.json`);
      if (!existsSync(file)) continue;
      const pids = JSON.parse(readFileSync(file, "utf8"));
      for (const pid of [pids.pid, pids.nested]) if (running(pid)) try { process.kill(pid, "SIGKILL"); } catch { /* exited */ }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("starts both dev commands from the project root and cleans their trees on Ctrl+C", async () => {
  const { directory, runner, exited } = start();
  const children = await ready(directory);
  expect(children[0]!.args.slice(2)).toEqual(["dev", "--port", "25649"]);
  expect(children[1]!.execArgv).toContain("--conditions=react-server");
  runner.kill("SIGINT");
  expect((await exited)[0]).toBe(130);
  for (const child of children) for (const pid of [child.pid, child.nested]) expect(running(pid)).toBe(false);
}, 12_000);

it.skipIf(process.platform === "win32")("stops the worker and remaining descendants when the web process fails", async () => {
  const { directory, exited } = start();
  const children = await ready(directory);
  writeFileSync(path.join(directory, "fail"), "");
  expect((await exited)[0]).toBe(7);
  for (const child of children) for (const pid of [child.pid, child.nested]) expect(running(pid)).toBe(false);
}, 12_000);
