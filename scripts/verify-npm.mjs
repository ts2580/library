import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tarball = path.resolve(process.argv[2] ?? path.join(root, `temp/npm/${pkg.version}/trstyq-bookshelf-${pkg.version}.tgz`));
fs.mkdirSync(path.join(root, "temp"), { recursive: true });
const evidenceDir = fs.mkdtempSync(path.join(root, "temp/npm-verify-"));
const tempRoot = fs.realpathSync(tmpdir());
const repoRoot = fs.realpathSync(root);
assert(tempRoot !== repoRoot && !tempRoot.startsWith(repoRoot + path.sep), "Set TMPDIR outside the checkout for independent installation");
const fixture = fs.mkdtempSync(path.join(tempRoot, "bookshelf-npm-install-"));
process.on("exit", () => fs.rmSync(fixture, { recursive: true, force: true }));
const caller = path.join(fixture, "사용자 책장 with spaces");
const install = path.join(fixture, "install");
fs.mkdirSync(caller);
fs.mkdirSync(install);
fs.writeFileSync(path.join(install, "package.json"), JSON.stringify({
  private: true, allowScripts: { "better-sqlite3": true, sharp: true }
}));
const npmEnv = { ...process.env };
delete npmEnv.NODE_PATH;
for (const key of Object.keys(npmEnv)) if (key.toLowerCase() === "npm_config_allow_scripts") delete npmEnv[key];
const result = spawnSync(process.execPath, [process.env.npm_execpath, "install", "--prefix", install,
  "--omit=dev", "--no-audit", "--no-fund", tarball], { cwd: caller, env: npmEnv, encoding: "utf8" });
fs.writeFileSync(path.join(evidenceDir, "install.log"), result.stdout + result.stderr);
assert.equal(result.status, 0, result.stderr);
const installedRoot = path.join(install, "node_modules/@trstyq/bookshelf");
const cli = path.join(installedRoot, "bin/bookshelf.mjs");
const installedRequire = createRequire(path.join(installedRoot, "package.json"));
const installedPkg = installedRequire("./package.json");
assert.equal(installedPkg.version, pkg.version);
const excelRequire = createRequire(installedRequire.resolve("exceljs"));
assert.equal(excelRequire("uuid/package.json").version, "11.1.1", "ExcelJS override was lost during installation");
const env = { ...npmEnv, NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) if (/^(BOOKSHELF_|REGISTRATION$|ALADIN_)/.test(key)) delete env[key];
function cliSync(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: caller, env, encoding: "utf8", timeout: 15000 });
}
assert.equal(cliSync(["--version"]).stdout.trim(), pkg.version);
assert.equal(cliSync(["--help"]).status, 0);
assert.equal(cliSync(["unexpected-command"]).status, 1);
assert.equal(cliSync(["--port", "99999"]).status, 1);
assert(!fs.existsSync(path.join(caller, "data")), "Informational/invalid commands created runtime data");
fs.mkdirSync(path.join(caller, "next/data"), { recursive: true });
fs.writeFileSync(path.join(caller, "next/data/bookshelf.sqlite"), "legacy placeholder");
assert.equal(cliSync(["worker"]).status, 1, "Legacy data migration guard was bypassed");
fs.rmSync(path.join(caller, "next"), { recursive: true });
const server = net.createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
fs.writeFileSync(path.join(caller, ".env"), "REGISTRATION=true\nBOOKSHELF_DATA_DIR=./persistent data\nBOOKSHELF_COOKIE_SECURE=false\n");
const url = `http://127.0.0.1:${port}`;
let runner;
let exited;
let output = "";
let sessionOffset = 0;
let browser;
function start(args = []) {
  sessionOffset = output.length;
  runner = spawn(process.execPath, [cli, "--port", String(port), "--hostname", "127.0.0.1", ...args], {
    cwd: caller, env, stdio: ["ignore", "pipe", "pipe"]
  });
  exited = once(runner, "exit");
  runner.stdout.on("data", data => { output += data; });
  runner.stderr.on("data", data => { output += data; });
}
async function ready() {
  for (let i = 0; i < 200; i++) {
    if (runner.exitCode !== null) throw new Error(`CLI exited before ready (${runner.exitCode})\n${output}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok && output.slice(sessionOffset).includes("Bookshelf worker started")) return;
    } catch { /* server starting */ }
    await delay(100);
  }
  throw new Error(`Application did not become ready\n${output}`);
}
async function waitExit() {
  let timer;
  return Promise.race([exited, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("CLI did not stop both services")), 8000);
  })]).finally(() => clearTimeout(timer));
}
async function stop(signal = "SIGTERM") {
  runner.kill(signal);
  assert.equal((await waitExit())[0], signal === "SIGINT" ? 130 : 143);
}
try {
  start();
  await ready();
  assert.notEqual(cliSync(["worker"]).status, 0, "A second worker accepted the same database");
  const { chromium } = require("@playwright/test");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("response", response => {
    if (response.url().includes("/_next/") && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${url}/signup`);
  await page.getByLabel("아이디", { exact: true }).fill("npm-smoke-user");
  await page.getByLabel("비밀번호", { exact: true }).fill("npm-smoke-password");
  await page.getByLabel("비밀번호 확인", { exact: true }).fill("npm-smoke-password");
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
  await page.context().clearCookies();
  await page.goto(`${url}/login`);
  await page.getByLabel("아이디", { exact: true }).fill("npm-smoke-user");
  await page.getByLabel("비밀번호", { exact: true }).fill("npm-smoke-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
  await page.screenshot({ path: path.join(evidenceDir, "installed-app.png"), fullPage: true });
  assert.deepEqual(failures, [], "Installed app has client or asset failures");
  await browser.close(); browser = null;
  await stop("SIGINT");
  assert(output.includes("Bookshelf worker stopped"), "Worker did not gracefully stop");
  await assert.rejects(fetch(`${url}/api/health`), "Web process survived CLI shutdown");
  const BetterSqlite3 = installedRequire("better-sqlite3");
  const database = path.join(caller, "persistent data/bookshelf.sqlite");
  const sqlite = new BetterSqlite3(database);
  assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM member WHERE username = ?").get("npm-smoke-user").count, 1);
  sqlite.close();
  output += "\n--- restart ---\n";
  start();
  await ready();
  await stop();
  const migrated = cliSync(["db:migrate"]);
  assert.equal(migrated.status, 0, migrated.stderr);
  assert(migrated.stdout.includes('"integrity_check": "ok"'));
  assert(!fs.existsSync(path.join(installedRoot, "data")), "Runtime data was written inside the installed package");
  output += "\n--- occupied port ---\n";
  const blocker = net.createServer();
  blocker.listen(port, "127.0.0.1");
  await once(blocker, "listening");
  try {
    start();
    assert.notEqual((await waitExit())[0], 0, "Web startup failure was reported as success");
  } finally { await new Promise(resolve => blocker.close(resolve)); }
  assert.equal(cliSync(["db:migrate"]).status, 0);
  start();
  await ready();
  await stop();
  const evidence = {
    name: installedPkg.name, version: installedPkg.version, platform: process.platform, arch: process.arch,
    node: process.version, tarball, sha256: createHash("sha256").update(fs.readFileSync(tarball)).digest("hex"),
    checks: ["isolated production install", "version/help/invalid options", "legacy migration guard",
      "caller .env and unicode paths", "web health and static assets", "worker lock", "signup and login",
      "SIGINT/SIGTERM shutdown", "restart with preserved account", "migration/integrity CLI", "web startup failure cleanup"],
    status: "PASS", fixture, evidenceDir
  };
  fs.writeFileSync(path.join(evidenceDir, "verification.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  if (runner && runner.exitCode === null && runner.signalCode === null) {
    runner.kill("SIGTERM");
    await waitExit();
  }
  fs.writeFileSync(path.join(evidenceDir, "runtime.log"), output);
  console.log(`Evidence: ${evidenceDir}`);
}
