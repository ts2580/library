import { chromium } from "@playwright/test";
import BetterSqlite3 from "better-sqlite3";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const image = process.env.HANDOVER_DOCKER_IMAGE ?? "bookshelf:migration-bridge-local";
const name = `bookshelf-handover-${randomUUID()}`;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bookshelf-handover-docker-"));
const artifacts = path.join(process.cwd(), "test-results/handover-docker");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let browser, created = false;
try {
  await fs.mkdir(path.join(directory, "covers")); await fs.mkdir(path.join(directory, "next-data"));
  await sharp({ create: { width: 20, height: 30, channels: 3, background: "#344c99" } }).webp().toFile(path.join(directory, "covers/fixture.webp"));
  const source = new BetterSqlite3(path.join(directory, "bookshelf.sqlite"));
  source.exec(await fs.readFile("tests/fixtures/legacy-schema.sql", "utf8"));
  source.prepare("INSERT INTO member(id,username,password_hash) VALUES(1,'trstyq',?)").run(createHash("sha256").update("fixture-only-password").digest("hex"));
  source.exec("INSERT INTO books(id,name,owner_id,cover) VALUES(1,'컨테이너 이전 확인',1,'/covers/fixture.webp'); INSERT INTO book_volumes(id,book,volume,seq) VALUES(1,1,1,99); INSERT INTO book_categories(name) VALUES('컨테이너 분류');"); source.close();
  docker("run", "-d", "--init", "--name", name, "--label", "bookshelf.test=handover",
    "-p", "127.0.0.1::25647", "-p", "127.0.0.1::25648",
    "-v", `${directory}:/data`, "-v", `${directory}/next-data:/app/next/data`,
    "-e", "SPRING_SQL_INIT_MODE=never", "-e", "ALADIN_TTB_KEY=", image); created = true;
  const info = JSON.parse(docker("inspect", name))[0];
  const legacyPort = info.NetworkSettings.Ports["25647/tcp"][0].HostPort;
  const nextPort = info.NetworkSettings.Ports["25648/tcp"][0].HostPort;
  const legacyOrigin = `http://127.0.0.1:${legacyPort}`;
  for (let n = 0; ; n++) {
    if (!JSON.parse(docker("inspect", name))[0].State.Running) throw new Error("Bridge container exited before startup");
    try { if ((await fetch(legacyOrigin + "/user/login")).ok) break; } catch { /* startup */ }
    if (n === 90) throw new Error("Bridge did not start");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
  await page.goto(legacyOrigin + "/user/login");
  await page.locator('input[name="username"]').fill("trstyq"); await page.locator('input[name="password"]').fill("fixture-only-password");
  await Promise.all([page.waitForURL("**/dashboard"), page.locator('button[type="submit"]').click()]);
  await page.goto(legacyOrigin + "/user/profile");
  await page.getByRole("button", { name: "새 책장으로 이전", exact: true }).click();
  let status;
  for (let n = 0; ; n++) {
    status = await (await page.request.get(legacyOrigin + "/user/profile/next-migration/status")).json();
    if (status.phase === "COMPLETED") break;
    if (["FAILED", "INTERRUPTED", "BLOCKED"].includes(status.phase) || n === 90) throw new Error(JSON.stringify(status));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(status.report.after.books, 1); assert.equal(status.report.after.book_volumes, 1); assert.equal(status.report.coverFiles, 1);
  assert.equal(status.readOnly, true);
  await page.getByRole("button", { name: "이전 완료", exact: true }).waitFor();
  assert.equal((await fetch(`http://127.0.0.1:${nextPort}/api/health`)).status, 200);
  const uid = docker("exec", name, "id", "-u", "bookshelf"); assert.equal(uid, "1001");
  await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "completed.png"), fullPage: true });
  await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: true, image: info.Image, uid, report: status.report }, null, 2));
  console.log("PASS Docker bridge profile button, SQLite native driver, web/worker and copied covers");
} catch (error) {
  if (created) {
    const logs = spawnSync("docker", ["logs", "--tail", "25", name], { encoding: "utf8" });
    console.error(logs.stdout, logs.stderr);
    try { console.error(docker("exec", name, "sh", "-c", "tail -40 /app/next/data/migrations/handover-*/runner.log")); } catch { /* no runner */ }
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (created) {
    try { docker("stop", "-t", "20", name); } catch { /* already exited */ }
    try { docker("rm", "-f", name); } catch { /* already removed */ }
  }
  // Restore ownership only inside this test's unique disposable directory.
  if (created) docker("run", "--rm", "--user", "0", "-v", `${directory}:/data`, "--entrypoint", "/bin/chown", image, "-hR", `${process.getuid()}:${process.getgid()}`, "/data");
  await fs.rm(directory, { recursive: true, force: true });
}
