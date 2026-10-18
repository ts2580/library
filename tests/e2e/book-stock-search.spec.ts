import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { tmpdir } from "node:os";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("book stock search appends through the worker without replacing old or unrelated inventory", async ({ page }) => {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"), { readonly: true });
  try {
    const before = db.prepare("SELECT * FROM branchbook ORDER BY id").all() as { id: number; book: number }[];
    const existingIds = new Set(before.map(row => row.id));
    await login(page, "fixture-book-stock");
    await page.goto("/books/4");
    const toolbar = page.locator(".volume-add-actions");
    await expect(toolbar.getByRole("button")).toHaveText(["직접 추가", "알라딘에서 검색", "재고 검색"]);
    for (const width of [1440, 412, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const buttons = await toolbar.getByRole("button").all();
      const rects = await Promise.all(buttons.map(button => button.boundingBox()));
      const toolbarRect = await toolbar.boundingBox();
      expect(Math.abs(rects[0]!.y - rects[2]!.y)).toBeLessThan(1);
      expect(Math.abs(rects[2]!.x + rects[2]!.width - toolbarRect!.x - toolbarRect!.width)).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = page.waitForResponse(value => value.url().endsWith("/api/books/4/stock-search") && value.request().method() === "POST");
      await toolbar.getByRole("button", { name: "재고 검색", exact: true }).click();
      expect((await response).status()).toBe(202);
      await expect(toolbar.getByRole("button", { name: "재고 검색", exact: true })).toBeDisabled();
      await expect(page.getByRole("status").filter({ hasText: "책 재고 검색 완료" })).toBeVisible({ timeout: 20_000 });
      await expect(toolbar.getByRole("button", { name: "재고 검색", exact: true })).toBeEnabled();
      await expect(page.locator(".volume-card").first().locator(".volume-meta")).toContainText("재고 3건");
      const after = db.prepare("SELECT * FROM branchbook ORDER BY id").all() as { id: number; book: number }[];
      expect(after.filter(row => existingIds.has(row.id))).toEqual(before);
      expect(after.filter(row => row.book !== 4)).toEqual(before.filter(row => row.book !== 4));
      expect(db.prepare("SELECT book,book_volume_id FROM branchbook WHERE id>31 AND book=4 ORDER BY id").all()).toEqual([
        { book: 4, book_volume_id: 6 }, { book: 4, book_volume_id: 6 }
      ]);
      expect(db.prepare("SELECT mode,scope_book_id,total,processed FROM stock_refresh_job WHERE id=1").get())
        .toEqual({ mode: "APPEND_BOOK", scope_book_id: 4, total: 1, processed: 1 });
    }
    expect((await page.request.post("/api/books/1/stock-search")).status()).toBe(404);
    expect((await page.request.post("/api/books/4/stock-search", { headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
  } finally { db.close(); }
});

test("book stock search preserves inventory administrator permissions", async ({ page }) => {
  expect((await page.request.post("/api/books/2/stock-search")).status()).toBe(401);
  await login(page, "fixture-user");
  await page.goto("/books/2");
  await expect(page.getByRole("button", { name: "재고 검색", exact: true })).toHaveCount(0);
  expect((await page.request.post("/api/books/2/stock-search")).status()).toBe(403);
  expect((await page.request.get("/api/books/2/stock-search")).status()).toBe(403);
});

for (const status of [401, 403, 404]) {
  test(`stock polling stops on terminal HTTP ${status} and releases the top progress bar`, async ({ page }) => {
    await login(page, "fixture-admin"); await page.goto("/books/1");
    let polls = 0;
    await page.route("**/api/books/1/stock-search", async route => {
      if (route.request().method() === "POST") await route.fulfill({ status: 202, json: { progress: {
        status: "RUNNING", mode: "APPEND_BOOK", scopeBookId: 1, message: "진행 중"
      } } });
      else { polls++; await route.fulfill({ status, json: { message: "종료 오류" } }); }
    });
    await page.getByRole("button", { name: "재고 검색", exact: true }).click();
    await expect(page.locator("#top-progress-bar")).toBeVisible();
    await expect.poll(() => polls).toBe(1);
    await expect(page.locator('.flash-error[role="alert"]')).toContainText("중단");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await page.waitForTimeout(1800);
    expect(polls).toBe(1);
  });
}

test("stock polling retries temporary errors and stops after completion", async ({ page }) => {
  await login(page, "fixture-admin"); await page.goto("/books/1");
  let polls = 0;
  await page.route("**/api/books/1/stock-search", async route => {
    if (route.request().method() === "POST") await route.fulfill({ status: 202, json: { progress: {
      status: "RUNNING", mode: "APPEND_BOOK", scopeBookId: 1, message: "진행 중"
    } } });
    else if (++polls === 1) await route.fulfill({ status: 503, json: { message: "일시 오류" } });
    else await route.fulfill({ json: { status: "COMPLETED", mode: "APPEND_BOOK", scopeBookId: 1, message: "재시도 완료" } });
  });
  await page.getByRole("button", { name: "재고 검색", exact: true }).click();
  await expect(page.locator('.flash-error[role="alert"]')).toBeVisible();
  await expect(page.locator("#top-progress-bar")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "재시도 완료" })).toBeVisible();
  await expect(page.locator("#top-progress-bar")).toBeHidden();
  await expect(page.getByRole("button", { name: "재고 검색", exact: true })).toBeEnabled();
  expect(polls).toBe(2);
});

test("deleting a running search's book in another tab stops polling the real API", async ({ page }, testInfo) => {
  await login(page, "fixture-admin");
  const created = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name: `삭제 중 재고 검색 ${testInfo.project.name}`, author: "", description: "", type: "", totalVolume: "", coverUrl: "" },
    direct: true, targetBookId: null, selection: []
  }) } });
  expect(created.status()).toBe(201);
  const { bookId } = await created.json();
  await page.goto(`/books/${bookId}`);
  await page.getByRole("button", { name: "직접 추가", exact: true }).click();
  const add = page.getByRole("region", { name: "권 직접 추가", exact: true });
  await add.getByLabel("권 제목", { exact: true }).fill("검색 중 삭제할 권");
  await add.getByLabel("ISBN13", { exact: true }).fill("9780000000999");
  await add.getByRole("button", { name: "권 추가", exact: true }).click();
  await expect(page.locator(".volume-card")).toHaveCount(1);
  const other = await page.context().newPage();
  await other.goto(`/books/${bookId}`);
  let release!: () => void;
  const deleted = new Promise<void>(resolve => { release = resolve; });
  let polls = 0;
  await page.route(`**/api/books/${bookId}/stock-search`, async route => {
    if (route.request().method() === "GET") { polls++; await deleted; }
    await route.continue();
  });
  try {
    const start = page.waitForResponse(response => response.url().endsWith(`/api/books/${bookId}/stock-search`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "재고 검색", exact: true }).click();
    expect((await start).status()).toBe(202);
    await expect(page.locator("#top-progress-bar")).toBeVisible();
    other.once("dialog", dialog => dialog.accept());
    await other.getByRole("button", { name: "책 삭제", exact: true }).click();
    await expect(other).toHaveURL(/\/books\?/);
    release();
    await expect(page.locator('.flash-error[role="alert"]')).toContainText("중단");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await page.waitForTimeout(1800);
    expect(polls).toBe(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await other.close();
  }
});
