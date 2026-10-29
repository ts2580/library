import { expect, test } from "@playwright/test";
import { openBookEditor } from "./helpers/book-editor";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

test("the book summary shows its author and editing opens a resettable modal that preserves failed edits", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const name = `책 편집 모달 ${testInfo.project.name}`;
  const response = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name, author: "기존 저자", description: "기존 설명", type: "", totalVolume: "", coverUrl: "" }, direct: true, targetBookId: null, selection: []
  }) } });
  expect(response.status()).toBe(201);
  const { bookId } = await response.json();
  await page.goto(`/books/${bookId}`);
  await expect(page.locator(".book-edit-form")).toHaveCount(0);
  await expect(page.locator(".book-hero .book-author")).toHaveText("저자 기존 저자");
  const editor = await openBookEditor(page);
  await editor.getByLabel("저자", { exact: true }).fill("저장하지 않은 저자");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: "책 정보 수정", exact: true })).toBeFocused();
  await openBookEditor(page);
  await expect(editor.getByLabel("저자", { exact: true })).toHaveValue("기존 저자");
  await expect(editor.getByLabel("표지 URL")).toHaveCount(0);
  await editor.getByLabel("저자", { exact: true }).fill("수정 저자");
  let fail = true;
  await page.route(`**/books/${bookId}`, route => route.request().method() === "POST" && fail ? route.abort("failed") : route.continue());
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인", exact: true }).click();
  await expect(editor.getByLabel("저자", { exact: true })).toHaveValue("수정 저자");
  fail = false;
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator(".book-hero .book-author")).toHaveText("저자 수정 저자");
  await expect(page.locator(".toast-message").last()).toHaveText("책 정보를 저장했습니다.");
  await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`));
  await page.screenshot({ path: testInfo.outputPath("book-summary-after-save.png"), fullPage: true });
  await openBookEditor(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books$/);
});

for (const invalidation of ["expired", "revoked"] as const) {
  test(`an ${invalidation} session preserves book edits, requests login and permits saving after reauthentication`, async ({ page }, testInfo) => {
    const directory = process.env.BOOKSHELF_E2E_DATA;
    if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
    const db = new Database(path.join(directory, "bookshelf.sqlite"));
    db.pragma("foreign_keys=ON");
    const username = `book-auth-${randomUUID()}`;
    const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'USER' FROM member WHERE id=1").run(username).lastInsertRowid);
    const original = "인증 오류 이전 책 제목";
    const edited = `인증 복구 후 제목 ${testInfo.project.name}`;
    const bookId = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES(?,?)").run(original, owner).lastInsertRowid);
    try {
      await page.goto("/login");
      await page.getByLabel("아이디", { exact: true }).fill(username);
      await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await page.goto(`/books/${bookId}`);
      const editor = await openBookEditor(page);
      await editor.getByLabel("제목", { exact: true }).fill(edited);
      if (invalidation === "expired") db.prepare("UPDATE app_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE member_id=?").run(owner);
      else db.prepare("DELETE FROM app_sessions WHERE member_id=?").run(owner);

      await editor.getByRole("button", { name: "저장", exact: true }).click();
      const error = page.getByRole("alertdialog");
      await expect(error).toContainText("로그인이 필요합니다.");
      await expect(error.locator(".error-dialog-code code")).toHaveText("UNAUTHORIZED");
      await expect(error).toContainText("다시 로그인한 뒤");
      expect(db.prepare("SELECT name FROM books WHERE id=?").get(bookId)).toEqual({ name: original });
      await error.getByRole("button", { name: "확인", exact: true }).click();
      await expect(editor.getByLabel("제목", { exact: true })).toHaveValue(edited);
      await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`));

      const login = await page.context().newPage();
      try {
        await login.goto("/login");
        await login.getByLabel("아이디", { exact: true }).fill(username);
        await login.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
        await login.getByRole("button", { name: "로그인", exact: true }).click();
        await expect(login).toHaveURL(/\/dashboard/);
      } finally { await login.close(); }
      await page.bringToFront();
      await editor.getByRole("button", { name: "저장", exact: true }).click();
      await expect(editor).toBeHidden();
      await expect(page.locator(".toast-message").last()).toHaveText("책 정보를 저장했습니다.");
      expect(db.prepare("SELECT name FROM books WHERE id=?").get(bookId)).toEqual({ name: edited });
    } finally {
      await page.close();
      db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
      db.prepare("DELETE FROM member WHERE id=?").run(owner);
      db.close();
    }
  });
}
