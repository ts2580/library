import { chromium } from "@playwright/test";
import BetterSqlite3 from "better-sqlite3";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const image = process.env.CLEANUP_DOCKER_IMAGE ?? "bookshelf-next:canary-local";
const name = `bookshelf-cleanup-${randomUUID()}`;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bookshelf-cleanup-docker-"));
const legacy = path.join(directory, "legacy"), data = path.join(directory, "next-data");
const adopted = path.join(data, "migrations/handover-aabb");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let browser, created = false, chowned = false;
try {
  await fs.mkdir(path.join(legacy, "covers"), { recursive: true }); await fs.mkdir(path.join(adopted, "covers"), { recursive: true });
  await sharp({ create: { width: 20, height: 30, channels: 3, background: "#344c99" } }).webp().toFile(path.join(legacy, "covers/fixture.webp"));
  const source = new BetterSqlite3(path.join(legacy, "bookshelf.sqlite"));
  source.exec(await fs.readFile("tests/fixtures/legacy-schema.sql", "utf8"));
  source.prepare("INSERT INTO member(id,username,password_hash) VALUES(1,'trstyq',?)").run(createHash("sha256").update("fixture-only-password").digest("hex"));
  source.exec("INSERT INTO books(id,name,owner_id,cover) VALUES(1,'원본 정리 후 유지할 도서',1,'/covers/fixture.webp'); INSERT INTO book_volumes(id,book,volume,seq) VALUES(1,1,1,99);"); source.close();
  await fs.copyFile(path.join(legacy, "bookshelf.sqlite"), path.join(adopted, "bookshelf.sqlite"));
  await fs.copyFile(path.join(legacy, "covers/fixture.webp"), path.join(adopted, "covers/fixture.webp"));
  execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/migrate.ts"], { stdio: "pipe", env: {
    ...process.env, NODE_ENV: "production", ALADIN_TTB_KEY: "", BOOKSHELF_DB_PATH: path.join(adopted, "bookshelf.sqlite"), BOOKSHELF_DATA_DIR: adopted, BOOKSHELF_LEGACY_OWNER_USERNAME: "trstyq"
  } });
  await fs.writeFile(path.join(data, "active-migration.json"), JSON.stringify({ version: 1, dataDir: "data/migrations/handover-aabb" }));
  const sentinel = path.join(directory, "permission-sentinel");
  await fs.writeFile(sentinel, "do not modify the symlink target");
  await fs.symlink("/sentinel", path.join(data, "permission-link"));
  // Alpine's former application UID differs from the new runtime UID. Do not pre-fix it.
  docker("run", "--rm", "--user", "0", "-v", `${directory}:/fixture`, "--entrypoint", "/bin/chown", image, "-hR", "100:101", "/fixture/legacy", "/fixture/next-data", "/fixture/permission-sentinel"); chowned = true;
  assert.equal((await fs.stat(legacy)).uid, 100);
  docker("run", "--rm", "--user", "1001", "-v", `${legacy}:/data/legacy`, image, "node", "-e",
    "try { require('fs').mkdirSync('/data/legacy/.permission-probe'); } catch (error) { if (error.code === 'EACCES') process.exit(0); throw error; } throw new Error('Expected legacy write denial before initialization');");
  docker("run", "--rm", "--user", "0", "--network", "none", "-v", `${data}:/data`, "-v", `${legacy}:/data/legacy`, "-v", `${sentinel}:/sentinel`, image, "node", "scripts/prepare-data-permissions.mjs");
  assert.equal((await fs.stat(legacy)).uid, 1001);
  assert.equal((await fs.stat(path.join(legacy, "bookshelf.sqlite"))).uid, 1001);
  assert.equal((await fs.stat(sentinel)).uid, 100, "Permission preparation must not follow symlinks");
  docker("run", "-d", "--init", "--name", name, "--label", "bookshelf.test=cleanup", "-p", "127.0.0.1::25647",
    "-v", `${data}:/data`, "-v", `${legacy}:/data/legacy`, "-e", "BOOKSHELF_LEGACY_DATA_DIR=/data/legacy", image); created = true;
  const info = JSON.parse(docker("inspect", name))[0]; const port = info.NetworkSettings.Ports["25647/tcp"][0].HostPort;
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    if (!JSON.parse(docker("inspect", name))[0].State.Running) throw new Error("Cleanup test container exited");
    try { if ((await fetch(origin + "/api/health")).ok) break; } catch { /* startup */ }
    if (attempt === 60) throw new Error("Next container did not start");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(origin + "/login"); await page.getByLabel("아이디", { exact: true }).fill("trstyq"); await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click(); await page.waitForURL("**/dashboard");
  const cleanupUrl = origin + "/api/migration/legacy-cleanup";
  const before = await page.request.get(cleanupUrl);
  assert.equal(before.status(), 200);
  const ready = await before.json();
  assert.equal(ready.state, "READY", ready.message); assert.equal(ready.canDelete, true);
  const response = await page.request.post(cleanupUrl, { headers: { origin } });
  assert.equal(response.status(), 200);
  const cleaned = await response.json();
  assert.equal(cleaned.state, "CLEANED", cleaned.message); assert.equal(cleaned.canDelete, false);
  const after = await page.request.get(cleanupUrl);
  assert.equal(after.status(), 200); assert.equal((await after.json()).state, "CLEANED");
  const verification = JSON.parse(docker("exec", name, "node", "-e", "const fs=require('fs'),DB=require('better-sqlite3'); const db=new DB('/data/migrations/handover-aabb/bookshelf.sqlite',{readonly:true}); console.log(JSON.stringify({sourceDb:fs.existsSync('/data/legacy/bookshelf.sqlite'),sourceCovers:fs.existsSync('/data/legacy/covers'),books:db.prepare('SELECT COUNT(*) AS n FROM books').get().n,backups:fs.readdirSync('/data/migrations/handover-aabb/backups').length})); db.close();"));
  assert.equal(verification.sourceDb, false); assert.equal(verification.sourceCovers, false); assert.equal(verification.books, 1); assert.ok(verification.backups > 0);
  assert.equal((await page.request.get(origin + "/api/covers/fixture.webp")).status(), 200);
  await page.goto(origin + "/books");
  await page.getByRole("heading", { name: "원본 정리 후 유지할 도서", exact: true }).waitFor();
  const artifacts = path.join(process.cwd(), "test-results/legacy-cleanup-docker"); await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "mobile-completed.png"), fullPage: true });
  await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: true, image: info.Image, legacyUidBefore: 100, legacyUidAfter: 1001, cleanupState: cleaned.state, ...verification }, null, 2));
  console.log("PASS Docker legacy UID repair, authenticated admin cleanup API, portable backup paths, preserved active DB and authenticated covers");
} catch (error) {
  if (created) { const logs = spawnSync("docker", ["logs", "--tail", "30", name], { encoding: "utf8" }); console.error(logs.stdout, logs.stderr); }
  throw error;
} finally {
  if (browser) await browser.close();
  if (created) { try { docker("stop", "-t", "20", name); } finally { docker("rm", "-f", name); } }
  if (chowned) docker("run", "--rm", "--user", "0", "-v", `${directory}:/fixture`, "--entrypoint", "/bin/chown", image, "-hR", `${process.getuid()}:${process.getgid()}`, "/fixture");
  await fs.rm(directory, { recursive: true, force: true });
}
