import { expect, test, type Page } from "@playwright/test";
import { openBookEditor } from "./helpers/book-editor";
import Database from "better-sqlite3";
import path from "node:path";
import { tmpdir } from "node:os";

async function setup(page: Page, query: string) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const created = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name: query, author: "", description: "", type: "", totalVolume: "", coverUrl: "" }, direct: true, targetBookId: null, selection: []
  }) } });
  expect(created.status()).toBe(201);
  const { bookId } = await created.json();
  await page.goto(`/aladin/search?bookId=${bookId}&query=${encodeURIComponent(query)}`);
  return bookId as number;
}

test("individual checks keep click order through rechecking, side stories and actual registration", async ({ page }, testInfo) => {
  await setup(page, `권차순서검증 직접 ${testInfo.project.name}`);
  for (const index of [3, 1, 2]) await page.getByLabel(`선택 선택 샘플 1-${index}`, { exact: true }).check();
  await page.getByLabel("선택 선택 샘플 1-1", { exact: true }).uncheck();
  await page.getByLabel("선택 선택 샘플 1-1", { exact: true }).check();
  await page.getByLabel("외전 선택 샘플 1-2", { exact: true }).check();
  const cards = page.locator(".search-result-card");
  await expect(cards.nth(2)).toContainText("1권으로 추가");
  await expect(cards.nth(0)).toContainText("2권으로 추가");
  await page.locator(".aladin-import-action").getByRole("button", { name: "3권 추가", exact: true }).click();
  await expect(page.locator(".volume-title h3")).toHaveText(["1권 · 선택 샘플 1-3", "2권 · 선택 샘플 1-1", "외전 · 선택 샘플 1-2"]);
  await openBookEditor(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/aladin\/search\?/);
});

test("bulk checks sort earlier dates first and equal dates in natural title order across pages", async ({ page }, testInfo) => {
  await setup(page, `권차순서검증 일괄 ${testInfo.project.name}`);
  await page.getByRole("button", { name: "현재 페이지 모두 선택", exact: true }).click();
  const cards = page.locator(".search-result-card");
  for (const [index, volume] of [[0, 4], [1, 2], [2, 3], [3, 1]]) await expect(cards.nth(index)).toContainText(`${volume}권으로 추가`);
  await page.getByRole("navigation", { name: "알라딘 검색 페이지" }).getByRole("button", { name: "다음 페이지" }).click();
  await expect(cards.first()).toContainText("선택 샘플 2-1");
  await page.getByRole("button", { name: "현재 페이지 모두 선택", exact: true }).click();
  await page.locator(".aladin-import-action").getByRole("button", { name: "8권 추가", exact: true }).click();
  await expect(page.locator(".volume-title h3")).toHaveText([
    "1권 · 선택 샘플 1-4", "2권 · 선택 샘플 2-4", "3권 · 선택 샘플 1-2", "4권 · 선택 샘플 1-3",
    "5권 · 선택 샘플 2-2", "6권 · 선택 샘플 2-3", "7권 · 선택 샘플 1-1", "8권 · 선택 샘플 2-1"
  ]);
  await openBookEditor(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/aladin\/search\?/);
});

test("bulk selection of the screenshot's descending same-date results keeps title volumes aligned", async ({ page }, testInfo) => {
  const bookId = await setup(page, `동일출간일역순검증 ${testInfo.project.name}`);
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  try {
    db.prepare("INSERT INTO book_volumes(book,volume,seq,name) VALUES(?,29,29,'기존 29권')").run(bookId);
    await page.reload();
    await page.getByRole("button", { name: "현재 페이지 모두 선택", exact: true }).click();
    const cards = page.locator(".search-result-card");
    await page.screenshot({ path: testInfo.outputPath("same-date-descending-selection.png"), fullPage: true });
    for (const [index, volume] of [33, 32, 31, 30].entries()) await expect(cards.nth(index)).toContainText(`${volume}권으로 추가`, { timeout: 2000 });
    await page.locator(".aladin-import-action").getByRole("button", { name: "4권 추가", exact: true }).click();
    await expect(page.locator(".volume-title h3")).toHaveText([
      "29권 · 기존 29권", "30권 · 츠구모모 30", "31권 · 츠구모모 31", "32권 · 츠구모모 32", "33권 · 츠구모모 33"
    ]);
    expect(db.prepare("SELECT name,volume FROM book_volumes WHERE book=? ORDER BY volume").all(bookId)).toEqual([
      { name: "기존 29권", volume: 29 }, ...[30, 31, 32, 33].map(volume => ({ name: `츠구모모 ${volume}`, volume }))
    ]);
  } finally {
    await page.close();
    db.prepare("DELETE FROM books WHERE id=?").run(bookId);
    db.close();
  }
});
