import { expect, test, type Page } from "@playwright/test";

async function profile(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/profile");
}

async function expectProfileWithoutMigration(page: Page) {
  await expect(page.getByRole("heading", { name: "기본 정보", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "비밀번호 변경", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "표지 재생성", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "미생성 표지 재생성", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "데이터 백업", exact: true })).toBeVisible();
  await expect(page.getByText("Migration", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "기존 데이터 정리", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기존 DB·표지 삭제", exact: true })).toHaveCount(0);
}

test("profile omits migration controls and makes no cleanup status requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/migration/legacy-cleanup")) requests.push(request.url()); });
  await profile(page);
  await expectProfileWithoutMigration(page);
  expect(requests).toEqual([]);
});

test("profile omits migration controls before browser JavaScript runs", async ({ page, browser }) => {
  await profile(page);
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto(page.url());
    await expectProfileWithoutMigration(staticPage);
  } finally { await context.close(); }
});
