import { expect, test } from "@playwright/test";

test("a server action error opens a coded dialog and returns focus after dismissal", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-wrong-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("INVALID_CREDENTIALS");
  await expect(dialog).toContainText("아이디 또는 비밀번호가 올바르지 않습니다.");
  await expect(dialog.getByRole("button", { name: "확인", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("login-error-dialog.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(dialog).toBeHidden();
});

test("an API error displays its server code above an existing dialog and copies details", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  const form = page.getByRole("dialog", { name: "책 직접 추가", exact: true });
  await page.route("**/api/aladin/search?**", route => route.fulfill({ status: 429, json: { code: "ALADIN_RATE_LIMIT", message: "알라딘 호출 제한 테스트" } }));
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text: string) => { document.documentElement.dataset.copiedError = text; }
  } }));
  await form.getByLabel("제목", { exact: true }).fill("오류 코드 검증");
  await form.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("ALADIN_RATE_LIMIT");
  await expect(dialog).toContainText("HTTP 429");
  await dialog.getByRole("button", { name: "상세 복사", exact: true }).click();
  await expect(dialog).toContainText("상세 오류를 복사했습니다.");
  expect(JSON.parse(await page.locator("html").getAttribute("data-copied-error") ?? "{}")).toMatchObject({ code: "ALADIN_RATE_LIMIT", status: 429 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("api-error-dialog.png"), fullPage: true });
  await dialog.getByRole("button", { name: "확인", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(form).toBeVisible();
  await expect(form.getByLabel("제목", { exact: true })).toHaveValue("오류 코드 검증");
  await form.getByRole("button", { name: "책 직접 추가 닫기", exact: true }).click();
  await expect(form).toBeHidden();
});
