import { expect, test } from "@playwright/test";
import { openBookEditor } from "./helpers/book-editor";

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
