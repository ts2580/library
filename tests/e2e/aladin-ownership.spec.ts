import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { tmpdir } from "node:os";

test("existing-book search disables owned K-code results and excludes them from bulk selection across pages", async ({ page }, info) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const query = `소장선택검증 ${info.project.name}`;
  const created = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name: query, author: "", description: "", type: "", totalVolume: "", coverUrl: "" }, direct: true, targetBookId: null, selection: []
  }) } });
  expect(created.status()).toBe(201);
  const { bookId } = await created.json();
  const previews = [];
  for (const number of [1, 2]) {
    const response = await page.request.get(`/api/aladin/search?${new URLSearchParams({ query, page: String(number) })}`);
    expect(response.status()).toBe(200);
    previews.push(await response.json());
  }
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  // This fixture uses the synthetic ISBN13 as its product ID; search HTML exposes only a K-code.
  const insert = db.prepare("INSERT INTO book_volumes(book,volume,name,isbn13,link) VALUES(?,?,?,?,?)");
  const foreignId = insert.run(2, 2, "타인 소장", previews[0].items[1].itemId, previews[0].items[1].link).lastInsertRowid;
  try {
    insert.run(bookId, 1, "기존 링크로 등록한 권", previews[0].items[0].itemId, `${previews[0].items[0].link}&partner=openAPI&start=api`);
    insert.run(bookId, 2, "ISBN만 등록한 권", previews[1].items[0].itemId, null);
    await page.goto("/aladin/search");
    await page.getByRole("combobox", { name: "기존 책 검색", exact: true }).fill(query);
    await page.getByRole("option").filter({ hasText: query }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("bookId")).toBe(String(bookId));
    const assertPage = async (number: number) => {
      const owned = page.getByLabel(`선택 선택 샘플 ${number}-1`, { exact: true });
      const available = page.getByLabel(`선택 선택 샘플 ${number}-2`, { exact: true });
      await expect(owned).toBeDisabled();
      await expect(owned).not.toBeChecked();
      await expect(page.locator(".search-result-card").first()).toContainText("이미 등록됨");
      await expect(available).toBeEnabled();
      await page.getByRole("button", { name: "현재 페이지 모두 선택", exact: true }).click();
      await expect(owned).not.toBeChecked();
      await expect(available).toBeChecked();
      await expect(page.getByRole("status").filter({ hasText: /^\d+권 선택$/ })).toHaveText(`${number}권 선택`);
    };
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await assertPage(1);
    await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
    await assertPage(2);
    await page.getByRole("button", { name: "이전 페이지", exact: true }).click();
    await expect(page.getByLabel("선택 선택 샘플 1-1", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("선택 선택 샘플 1-2", { exact: true })).toBeChecked();
    await page.screenshot({ path: info.outputPath("owned-checkbox-disabled.png"), fullPage: true });
  } finally {
    await page.close();
    db.prepare("DELETE FROM book_volumes WHERE id=?").run(foreignId);
    db.prepare("DELETE FROM books WHERE id=?").run(bookId);
    db.close();
  }
});
