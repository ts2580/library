import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { tmpdir } from "node:os";

async function withLogs(page: Page, name: string, run: (db: Database.Database, owner: number, volumes: number[]) => Promise<void>) {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1").run(name).lastInsertRowid);
  const book = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES('실패 로그 검증 책',?)").run(owner).lastInsertRowid);
  const volumes = [1, 2, 3, 4].map(number => Number(db.prepare("INSERT INTO book_volumes(book,volume,name,isbn13) VALUES(?,?,?,?)")
    .run(book, number, `로그 검증 ${number}권`, number === 4 ? "9780000000193" : null).lastInsertRowid));
  try {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill(name);
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await run(db, owner, volumes);
  } finally {
    await page.close();
    db.prepare("UPDATE stock_refresh_job SET status='IDLE',running=0,completed=0,failed=0,requested_by=NULL,lock_token=NULL,run_id=NULL WHERE requested_by=?").run(owner);
    db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM member WHERE id=?").run(owner);
    db.close();
  }
}

test("worker failures show reasons and individual and selected refresh clear only resolved failures", async ({ page }, testInfo) => {
  await withLogs(page, `stock-logs-${testInfo.project.name}`, async (db, owner, volumes) => {
    await page.goto("/inventory");
    await expect(page.getByRole("button", { name: /실패 건 재시도/ })).toHaveCount(0);
    await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
    await expect(page.locator(".status-badge")).toHaveText("COMPLETED");
    await expect(page.getByRole("alertdialog")).toContainText("3권 실패");
    await page.getByRole("alertdialog").getByRole("button", { name: "확인", exact: true }).click();
    const retry = page.getByRole("button", { name: "실패 건 재시도 (3)", exact: true });
    await expect(retry).toBeEnabled();
    expect(await page.locator(".stock-refresh-actions > button").allTextContents()).toEqual(["전체 삭제", "실패 건 재시도 (3)", "갱신 시작"]);
    const untouched = db.prepare("SELECT * FROM branchbook WHERE book_volume_id=?").all(volumes[3]);
    expect(untouched).toHaveLength(2);
    await page.getByRole("link", { name: "갱신 로그", exact: true }).click();
    await expect(page.getByRole("heading", { name: "미해결 실패 3권" })).toBeVisible();
    const entries = page.getByTestId("stock-log-entry");
    await expect(entries).toHaveCount(3);
    await expect(entries.first()).toContainText("ISBN이 없어 재고를 조회할 수 없습니다.");
    await expect(entries.first()).toContainText("ISBN_MISSING");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("stock-refresh-logs.png"), fullPage: true });
    db.prepare("UPDATE book_volumes SET isbn13='9780000000193' WHERE id=?").run(volumes[0]);
    await entries.filter({ has: page.getByRole("heading", { name: "로그 검증 1권", exact: false }) }).getByRole("button", { name: "개별 갱신" }).click();
    await expect(page.getByRole("heading", { name: "미해결 실패 2권" })).toBeVisible();
    await expect(entries).toHaveCount(2);
    await expect(page.getByRole("button", { name: "실패 건 재시도 (2)" })).toBeEnabled();
    expect(db.prepare("SELECT * FROM branchbook WHERE book_volume_id=?").all(volumes[3])).toEqual(untouched);
    for (const id of volumes.slice(1, 3)) db.prepare("UPDATE book_volumes SET isbn13='9780000000193' WHERE id=?").run(id);
    await page.getByLabel("이 페이지 전체 선택", { exact: true }).check();
    await page.getByRole("button", { name: "선택 갱신 (2)", exact: true }).click();
    await expect(page.getByRole("heading", { name: "미해결 실패 0권" })).toBeVisible();
    await expect(page.locator(".empty")).toContainText("미해결 갱신 실패가 없습니다.");
    await expect(entries).toHaveCount(0);
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await page.getByRole("link", { name: "전체 기록", exact: true }).click();
    await expect(entries).toHaveCount(7);
    expect(db.prepare("SELECT * FROM branchbook WHERE book_volume_id=?").all(volumes[3])).toEqual(untouched);
    await page.getByRole("link", { name: "지점 재고로", exact: true }).click();
    await expect(page.getByRole("button", { name: /실패 건 재시도/ })).toHaveCount(0);
    expect(db.prepare("SELECT COUNT(*) n FROM stock_refresh_log WHERE owner_id=?").get(owner)).toEqual({ n: 7 });
  });
});

test("inventory failure retry uses the worker and rejects foreign and malformed selections", async ({ page }, testInfo) => {
  await withLogs(page, `stock-retry-all-${testInfo.project.name}`, async (db, owner, volumes) => {
    for (const id of volumes.slice(0, 2)) {
      db.prepare("UPDATE book_volumes SET isbn13='9780000000193' WHERE id=?").run(id);
      db.prepare("INSERT INTO stock_refresh_log(owner_id,book_id,volume_id,run_id,status,code,message) SELECT ?,book,id,?,'FAILED','ALADIN_TIMEOUT','알라딘 응답 시간이 초과되었습니다.' FROM book_volumes WHERE id=?")
        .run(owner, `prior-${id}`, id);
    }
    db.prepare("INSERT INTO branchbook(book,book_volume_id,volume,branch,price,name) SELECT book,id,volume,'UNTOUCHED','800','선택 외 재고' FROM book_volumes WHERE id=?").run(volumes[3]);
    const untouched = db.prepare("SELECT * FROM branchbook WHERE book_volume_id=?").all(volumes[3]);
    expect((await page.request.post("/api/stock-refresh/retry", { data: { volumeIds: [1] } })).status()).toBe(404);
    expect((await page.request.post("/api/stock-refresh/retry", { data: { volumeIds: [] } })).status()).toBe(400);
    expect((await page.request.post("/api/stock-refresh/retry", { data: {} , headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
    await page.goto("/inventory");
    await page.getByRole("button", { name: "실패 건 재시도 (2)", exact: true }).click();
    await expect(page.locator(".status-badge")).toHaveText("COMPLETED");
    await expect(page.getByRole("button", { name: /실패 건 재시도/ })).toHaveCount(0);
    expect(db.prepare("SELECT * FROM branchbook WHERE book_volume_id=?").all(volumes[3])).toEqual(untouched);
    expect(db.prepare("SELECT COUNT(*) n FROM stock_refresh_log WHERE owner_id=?").get(owner)).toEqual({ n: 4 });
    expect((await page.request.get("/api/stock-refresh/logs")).status()).toBe(200);
    expect((await (await page.request.get("/api/stock-refresh/logs")).json()).logs.pendingFailures).toBe(0);
  });
});

test("log retry errors open a popup and release request progress", async ({ page }, testInfo) => {
  await withLogs(page, `stock-log-errors-${testInfo.project.name}`, async (db, owner, volumes) => {
    db.prepare("INSERT INTO stock_refresh_log(owner_id,book_id,volume_id,run_id,status,code,message) SELECT ?,book,id,'prior','FAILED','ISBN_MISSING','ISBN 미등록' FROM book_volumes WHERE id=?").run(owner, volumes[0]);
    await page.goto("/inventory/logs");
    await page.route("**/api/stock-refresh/retry", route => route.fulfill({ status: 503, json: { code: "WORKER_UNAVAILABLE", message: "갱신 요청 테스트 오류" } }));
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "개별 갱신" }).click();
      await expect(page.getByRole("alertdialog")).toContainText("갱신 요청 테스트 오류");
      await page.getByRole("alertdialog").getByRole("button", { name: "확인", exact: true }).click();
      await expect(page.getByRole("button", { name: "개별 갱신" })).toBeEnabled();
      await expect(page.locator("#top-progress-bar")).toBeHidden();
    }
  });
});
