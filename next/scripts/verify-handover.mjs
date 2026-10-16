// Uses disposable accounts, DBs and ports. Never starts or stops the user's app.
import { chromium } from "@playwright/test";
import BetterSqlite3 from "better-sqlite3";
import sharp from "sharp";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";

const app = process.cwd();
const repository = path.dirname(app);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bookshelf-handover-e2e-"));
const legacyPort = 25649, nextPort = 25650;
const origin = `http://127.0.0.1:${legacyPort}`;
const jar = path.join(repository, "build/libs/bookshelf-2.10.0.jar");
const sandbox = path.join(root, "next");
const source = path.join(root, "legacy", "bookshelf.sqlite");
const covers = path.join(root, "legacy", "covers");
const artifacts = path.join(app, "test-results/handover");
const dummyPassword = "fixture-only-password";
let legacy, standalone, browser, occupied;

async function until(check, message, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 200)); }
  throw new Error(message);
}
async function stopLegacy() {
  if (!legacy || legacy.exitCode !== null || legacy.signalCode !== null) return;
  const child = legacy;
  await new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 20_000).unref(); });
}
async function startLegacy() {
  const log = await fs.open(path.join(root, "spring.log"), "a");
  legacy = spawn("java", ["-jar", jar], { cwd: repository, stdio: ["ignore", log.fd, log.fd], env: {
    ...process.env, SERVER_PORT: String(legacyPort),
    SPRING_DATASOURCE_URL: `jdbc:sqlite:${source}?foreign_keys=on&busy_timeout=5000`,
    SPRING_SQL_INIT_MODE: "never", SPRING_PROFILES_ACTIVE: "", REGISTRATION: "false", ALADIN_TTB_KEY: "",
    BOOKSHELF_COVER_DIR: covers, BOOKSHELF_APP_LOG_FILE: path.join(root, "spring-app.log"),
    BOOKSHELF_NEXT_APP_DIR: sandbox, BOOKSHELF_NEXT_PORT: String(nextPort), BOOKSHELF_NEXT_PUBLIC_URL: `http://127.0.0.1:${nextPort}`
  } });
  await log.close();
  await until(async () => { if (legacy.exitCode !== null) throw new Error("Isolated Spring exited; inspect spring.log"); try { return (await fetch(origin + "/user/login")).ok; } catch { return false; } }, "Spring did not start");
}
async function loginSpring(page) {
  await page.goto(origin + "/user/login");
  await page.locator('input[name="username"]').fill("trstyq");
  await page.locator('input[name="password"]').fill(dummyPassword);
  await Promise.all([page.waitForURL("**/dashboard"), page.locator('button[type="submit"]').click()]);
}
async function status(page) { const response = await page.request.get(origin + "/user/profile/next-migration/status"); return response.json(); }

try {
  await fs.access(jar); await fs.access(path.join(app, ".next/BUILD_ID"));
  await fs.mkdir(sandbox);
  for (const entry of ["node_modules", ".next", "scripts", "features", "db", "lib", "worker", "app", "components", "public"]) await fs.symlink(path.join(app, entry), path.join(sandbox, entry));
  for (const entry of ["package.json", "tsconfig.json", "next.config.ts"]) await fs.copyFile(path.join(app, entry), path.join(sandbox, entry));
  await fs.copyFile(path.join(app, ".env.example"), path.join(sandbox, ".env"));
  await fs.mkdir(covers, { recursive: true });
  await sharp({ create: { width: 40, height: 60, channels: 3, background: "#506ac0" } }).webp().toFile(path.join(covers, "fixture.webp"));
  const db = new BetterSqlite3(source);
  db.exec(await fs.readFile(path.join(app, "tests/fixtures/legacy-schema.sql"), "utf8"));
  db.prepare("INSERT INTO member(id,username,password_hash) VALUES(1,'trstyq',?)").run(createHash("sha256").update(dummyPassword).digest("hex"));
  db.exec("INSERT INTO books(id,name,type,owner_id,cover,cover_generated) VALUES(1,'이전 전 도서','기존 분류',1,'/covers/fixture.webp',1); INSERT INTO book_volumes(id,book,name,seq,volume) VALUES(1,1,'이전 전 1권',99,1); INSERT INTO book_categories(name) VALUES('기존 분류'),('책 없이 저장한 분류');");
  db.close();
  await fs.mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await startLegacy(); await loginSpring(page);
  await page.goto(origin + "/books");
  await page.locator("#openBookCreateDialog").click();
  const category = page.locator("#bookCreateCategory");
  assert.equal(await category.locator("option").last().textContent(), "카테고리 추가");
  await category.selectOption("saved:책 없이 저장한 분류");
  await category.selectOption("add");
  await page.locator("#bookCreateNewCategory").fill("새로 만든 분류");
  await page.locator("#bookCreateAddCategory").click();
  await until(async () => (await category.inputValue()) === "saved:새로 만든 분류", "Category was not saved");
  await page.reload(); await page.locator("#openBookCreateDialog").click();
  await category.selectOption("saved:새로 만든 분류");
  await page.locator("#bookCreateNonAladin").check();
  await page.locator("#bookCreateName").fill("콤보박스로 추가한 도서");
  await page.locator("#bookCreateSubmit").click();
  await page.waitForURL(/\/books\/\d+/);
  await page.goto(origin + "/books"); await page.locator("#openBookCreateDialog").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await category.selectOption("add");
  await page.screenshot({ path: path.join(artifacts, "spring-category-mobile.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.goto(origin + "/user/profile");
  assert.equal(await page.locator('[data-next-migration-link]').isVisible(), false);
  await page.screenshot({ path: path.join(artifacts, "spring-profile-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(artifacts, "spring-profile-desktop.png"), fullPage: true });

  // Preflight failure must leave the original writable and allow a fresh retry.
  occupied = net.createServer(); await new Promise((resolve, reject) => { occupied.once("error", reject); occupied.listen(nextPort, "0.0.0.0", resolve); });
  await page.getByRole("button", { name: "새 책장으로 이전", exact: true }).click();
  await until(async () => { const value = await status(page); return value.phase === "FAILED" && !value.running && !value.readOnly; }, "Busy-port failure did not restore writes");
  await new Promise((resolve) => occupied.close(resolve)); occupied = null;
  await until(async () => page.getByRole("button", { name: "새 책장으로 이전", exact: true }).isEnabled(), "Retry button did not recover");
  console.log("PASS busy-port failure restores original writes and retry");

  await page.getByRole("button", { name: "새 책장으로 이전", exact: true }).click();
  await until(async () => { const value = await status(page); if (["FAILED", "INTERRUPTED", "BLOCKED"].includes(value.phase)) throw new Error(JSON.stringify(value)); return value.phase === "COMPLETED"; }, "Migration did not complete");
  const migrated = await status(page);
  assert.equal(migrated.report.after.books, 2); assert.equal(migrated.report.after.book_volumes, 1);
  assert.equal(migrated.report.coverFiles, 1); assert.equal(migrated.report.missingCovers, 0);
  assert.equal(migrated.readOnly, true);
  await until(async () => page.getByRole("button", { name: "이전 완료", exact: true }).isVisible(), "Completion was not rendered");
  assert.equal(await page.locator('[data-next-migration-link]').isVisible(), true);
  const csrf = await page.locator('[data-next-migration-form] input[type="hidden"]').inputValue();
  assert.equal((await page.request.post(origin + "/books/categories", { form: { name: "must-not-save", _csrf: csrf } })).status(), 423);
  assert.equal((await page.request.post(origin + "/user/profile/next-migration/start", { form: { _csrf: csrf } })).status(), 409);
  const original = new BetterSqlite3(source, { readonly: true });
  assert.equal(original.prepare("SELECT COUNT(*) AS n FROM books").get().n, 2);
  assert.equal(original.prepare("SELECT name FROM sqlite_master WHERE name='app_sessions'").get(), undefined); original.close();
  await page.screenshot({ path: path.join(artifacts, "spring-migration-completed.png"), fullPage: true });
  const nextPage = await context.newPage();
  await nextPage.goto(`http://127.0.0.1:${nextPort}/login`);
  await nextPage.getByLabel("아이디", { exact: true }).fill("trstyq"); await nextPage.getByLabel("비밀번호", { exact: true }).fill(dummyPassword);
  await nextPage.getByRole("button", { name: "로그인", exact: true }).click(); await nextPage.waitForURL("**/dashboard");
  await nextPage.goto(`http://127.0.0.1:${nextPort}/books`); await nextPage.getByText("책 직접 추가", { exact: true }).click();
  const nextSelect = nextPage.locator("#manual-category");
  await nextSelect.waitFor({ state: "visible" });
  assert.equal(await nextSelect.locator('option[value="saved:새로 만든 분류"]').count(), 1);
  assert.equal(await nextSelect.locator('option[value="saved:책 없이 저장한 분류"]').count(), 1);
  await nextPage.getByLabel("알라딘 외 등록", { exact: false }).check();
  const form = nextPage.locator("form").filter({ has: nextPage.getByRole("button", { name: "책 추가", exact: true }) });
  await form.getByLabel("제목", { exact: true }).fill("이전 후 새로 저장한 도서"); await nextSelect.selectOption("saved:새로 만든 분류");
  await form.getByRole("button", { name: "책 추가", exact: true }).click(); await nextPage.waitForURL(/\/books\/\d+/);
  console.log("PASS profile button migrates DB/covers/categories and starts Next web/worker");

  await stopLegacy();
  await until(async () => { try { await fetch(`http://127.0.0.1:${nextPort}/api/health`); return false; } catch { return true; } }, "Next child did not stop", 20_000);
  // Default .env paths must adopt the persisted handover after restart.
  const verification = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/verify-db.ts"], { cwd: sandbox, env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8" }));
  assert.ok(verification.database.includes("handover-")); assert.equal(verification.foreignKeyViolationCount, 0);
  await startLegacy(); await loginSpring(page); await page.goto(origin + "/user/profile");
  assert.equal((await status(page)).readOnly, true);
  await until(async () => page.getByRole("button", { name: "새 책장 다시 시작", exact: true }).isEnabled(), "Resume not enabled");
  await page.getByRole("button", { name: "새 책장 다시 시작", exact: true }).click();
  await until(async () => (await status(page)).phase === "COMPLETED", "Resume did not complete");
  const pointer = JSON.parse(await fs.readFile(path.join(sandbox, "data/active-migration.json"), "utf8"));
  const adopted = new BetterSqlite3(path.join(sandbox, pointer.dataDir, "bookshelf.sqlite"), { readonly: true });
  assert.equal(adopted.prepare("SELECT COUNT(*) AS n FROM books").get().n, 3); adopted.close();
  console.log("PASS restart preserves read-only source, active DB and post-migration writes");
  await nextPage.goto(`http://127.0.0.1:${nextPort}/profile`);
  const blocked = await (await nextPage.request.get(`http://127.0.0.1:${nextPort}/api/migration/legacy-cleanup`)).json();
  assert.equal(blocked.state, "BLOCKED"); assert.match(blocked.message, /프로세스/);
  await stopLegacy();
  await until(async () => { try { await fetch(`http://127.0.0.1:${nextPort}/api/health`); return false; } catch { return true; } }, "Managed Next did not stop", 20_000);
  const standaloneLog = await fs.open(path.join(root, "standalone.log"), "a");
  standalone = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(nextPort), "--hostname", "127.0.0.1"], {
    cwd: sandbox, stdio: ["ignore", standaloneLog.fd, standaloneLog.fd],
    env: { ...process.env, NODE_ENV: "production", BOOKSHELF_LEGACY_DATA_DIR: path.dirname(source) }
  });
  await standaloneLog.close();
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${nextPort}/api/health`)).ok; } catch { return false; } }, "Standalone Next did not start");
  await nextPage.goto(`http://127.0.0.1:${nextPort}/profile`);
  const cleanupButton = nextPage.getByRole("button", { name: "기존 DB·표지 삭제", exact: true });
  await until(async () => cleanupButton.isEnabled(), "Cleanup did not become available");
  nextPage.once("dialog", (dialog) => dialog.dismiss()); await cleanupButton.click();
  await fs.access(source); await fs.access(path.join(covers, "fixture.webp"));
  nextPage.once("dialog", (dialog) => dialog.accept()); await cleanupButton.click();
  await nextPage.getByRole("button", { name: "원본 삭제 완료", exact: true }).waitFor();
  assert.equal(await fs.access(source).then(() => true, () => false), false);
  assert.equal(await fs.access(covers).then(() => true, () => false), false);
  const remaining = new BetterSqlite3(path.join(sandbox, pointer.dataDir, "bookshelf.sqlite"), { readonly: true });
  assert.equal(remaining.prepare("SELECT COUNT(*) AS n FROM books").get().n, 3); remaining.close();
  await nextPage.screenshot({ path: path.join(artifacts, "next-legacy-cleanup-completed.png"), fullPage: true });
  console.log("PASS cleanup button blocks live Spring, respects cancellation, and preserves Next data");
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: true, sourceBooks: 2, migratedBooksAfterNewWrite: 3, categoriesPreserved: true, failureRecovery: true, restartRecovery: true, cleanupVerified: true, browserErrors: errors }, null, 2));
} catch (error) {
  // Logs contain only this script's dummy fixture accounts and environment.
  for (const filename of [path.join(root, "spring.log")]) {
    try { console.error((await fs.readFile(filename, "utf8")).split("\n").slice(-35).join("\n")); } catch { /* absent */ }
  }
  try {
    for (const name of await fs.readdir(path.join(sandbox, "data/migrations"))) {
      try { console.error((await fs.readFile(path.join(sandbox, "data/migrations", name, "runner.log"), "utf8")).slice(-5000)); } catch { /* preflight */ }
    }
  } catch { /* not created */ }
  throw error;
} finally {
  if (occupied) await new Promise((resolve) => occupied.close(resolve));
  if (standalone && standalone.exitCode === null) await new Promise((resolve) => { standalone.once("exit", resolve); standalone.kill("SIGTERM"); setTimeout(() => standalone.kill("SIGKILL"), 10_000).unref(); });
  await stopLegacy(); if (browser) await browser.close();
  await fs.rm(root, { recursive: true, force: true });
}
