import { expect, test, type Page } from "@playwright/test";
import { openBookEditor } from "./helpers/book-editor";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

async function withBook(page: Page, run: (db: Database.Database, bookId: number, name: string) => Promise<void>) {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  const username = `volume-scroll-${randomUUID()}`;
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1").run(username).lastInsertRowid);
  const name = "스크롤을 유지할 책 제목";
  const bookId = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES(?,?)").run(name, owner).lastInsertRowid);
  for (let number = 1; number <= 18; number++) db.prepare("INSERT INTO book_volumes(book,volume,name,description) VALUES(?,?,?,?)").run(bookId, number, `스크롤 검증 ${number}권`, "권 설명입니다. ".repeat(15));
  try {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto(`/books/${bookId}`);
    await run(db, bookId, name);
  } finally {
    await page.close();
    db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM member WHERE id=?").run(owner);
    db.close();
  }
}

test("first and repeated purchase saves keep the page scroll position and close the details dialog", async ({ page }, testInfo) => {
  await withBook(page, async (db, bookId) => {
    await page.route(`**/books/${bookId}`, async route => {
      if (route.request().method() === "POST") await new Promise(resolve => setTimeout(resolve, 300));
      await route.continue();
    });
    const card = page.locator(".volume-card").filter({ has: page.getByRole("heading", { name: "12권 · 스크롤 검증 12권", exact: true }) });
    const trigger = card.getByRole("button", { name: "상세정보", exact: true });
    const modal = page.getByRole("dialog", { name: "12권 · 스크롤 검증 12권", exact: true });
    for (const purchased of [true, false, true]) {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await expect(modal).toBeVisible();
      const before = await page.evaluate(() => window.scrollY);
      expect(before).toBeGreaterThan(500);
      await modal.getByLabel("구매 완료", { exact: true }).setChecked(purchased);
      await modal.getByRole("button", { name: "저장", exact: true }).click();
      await expect(modal).toBeHidden();
      await expect(page.locator(".toast").filter({ hasText: "권 정보를 수정했습니다." })).toBeVisible();
      await expect.poll(() => (db.prepare("SELECT ispurchased FROM book_volumes WHERE book=? AND volume=12").get(bookId) as { ispurchased: number }).ispurchased).toBe(Number(purchased));
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
      await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(3);
      if (purchased) await expect(card.locator(".status-badge")).toHaveText("구매 완료");
      else await expect(card.locator(".status-badge")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`));
    }
    await page.screenshot({ path: testInfo.outputPath("purchase-save-scroll-preserved.png") });
  });
});

test("an invalid modal save keeps edited values and scroll, then permits a successful keyboard save", async ({ page }) => {
  await withBook(page, async (db, bookId) => {
    const card = page.locator(".volume-card").filter({ has: page.getByRole("heading", { name: "12권 · 스크롤 검증 12권", exact: true }) });
    await card.getByRole("button", { name: "상세정보", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "12권 · 스크롤 검증 12권", exact: true });
    const before = await page.evaluate(() => window.scrollY);
    await modal.getByLabel("가격", { exact: true }).fill("invalid");
    await modal.getByLabel("구매 완료", { exact: true }).check();
    await modal.getByRole("button", { name: "저장", exact: true }).click();
    const error = page.getByRole("alertdialog");
    await expect(error).toContainText("VALIDATION_ERROR");
    await error.getByRole("button", { name: "확인", exact: true }).click();
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("가격", { exact: true })).toHaveValue("invalid");
    await expect(modal.getByLabel("구매 완료", { exact: true })).toBeChecked();
    expect((db.prepare("SELECT ispurchased FROM book_volumes WHERE book=? AND volume=12").get(bookId) as {ispurchased:number}).ispurchased).toBe(0);
    await modal.getByLabel("가격", { exact: true }).fill("1000");
    await modal.getByLabel("저자", { exact: true }).press("Enter");
    await expect(modal).toBeHidden();
    await expect(card.locator(".status-badge")).toHaveText("구매 완료");
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(3);
    await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`));
  });
});

test("the tab title follows the owned book name and does not reveal another owner's book", async ({ page }) => {
  await withBook(page, async (_db, bookId, name) => {
    await expect(page).toHaveTitle(`${name} · Bookshelf`);
    await openBookEditor(page);
    const editor = page.getByRole("form", { name: "책 정보", exact: true });
    const next = "수정한 실제 책 제목";
    await editor.getByLabel("제목", { exact: true }).fill(next);
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page).toHaveTitle(`${next} · Bookshelf`);
    await page.reload();
    await expect(page).toHaveTitle(`${next} · Bookshelf`);
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill("fixture-user");
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto(`/books/${bookId}`);
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다.", exact: true })).toBeVisible();
    await expect(page).not.toHaveTitle(new RegExp(next));
  });
});
