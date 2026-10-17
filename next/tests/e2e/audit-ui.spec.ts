import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username = "fixture-admin") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("backup upload buttons are keyboard reachable and activate file selection", async ({ page }) => {
  await login(page); await page.goto("/profile");
  await page.getByRole("link", { name: "엑셀 다운로드", exact: true }).focus();
  await page.keyboard.press("Tab");
  const excel = page.getByRole("button", { name: "엑셀 업로드", exact: true });
  await expect(excel).toBeFocused();
  const [excelChooser] = await Promise.all([page.waitForEvent("filechooser"), excel.press("Enter")]);
  await excelChooser.setFiles([]);
  await page.getByRole("link", { name: "표지 다운로드", exact: true }).focus();
  await page.keyboard.press("Tab");
  const covers = page.getByRole("button", { name: "표지 업로드", exact: true });
  await expect(covers).toBeFocused();
  const [coverChooser] = await Promise.all([page.waitForEvent("filechooser"), covers.press("Space")]);
  await coverChooser.setFiles([]);
});

test("a saved restore job survives slow polling without presenting upload 100% as completion", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => sessionStorage.setItem("bookshelf.cover-restore-job", "audit-job"));
  let calls = 0;
  await page.route("**/api/backup/covers/uploads/audit-job/status", async (route) => {
    const completed = ++calls >= 2;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ json: { status: completed ? "COMPLETED" : "QUEUED", percent: 100,
      totalChunks: 1, uploadedChunks: 1, completed, message: completed ? "테스트 복원 완료" : "테스트 워커 대기" } });
  });
  await page.goto("/profile");
  await expect(page.getByText("테스트 워커 대기", { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.locator("progress")).not.toHaveAttribute("value");
  await expect(page.getByText("테스트 복원 완료", { exact: true })).toBeVisible({ timeout: 12_000 });
  expect(await page.evaluate(() => sessionStorage.getItem("bookshelf.cover-restore-job"))).toBeNull();
});

test("the ordinary user's mobile menu has one column per item", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "fixture-user");
  const nav = page.getByRole("navigation", { name: "모바일 주 메뉴" });
  await expect(nav).toBeVisible();
  expect(await nav.locator("a").count()).toBe(4);
  expect(await nav.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(4);
});

test("mobile volume editing uses the card width rather than the cover side column", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page); await page.goto("/books/1");
  const card = page.locator(".volume-card").first();
  const details = card.locator("details").first();
  await details.locator("summary").click();
  const cardBox = await card.boundingBox();
  const formBox = await details.locator("form").first().boundingBox();
  expect(cardBox).not.toBeNull(); expect(formBox).not.toBeNull();
  expect(formBox!.width).toBeGreaterThan(cardBox!.width * 0.65);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
