import { expect, test, type Page } from "@playwright/test";

const endpoint = "**/api/migration/legacy-cleanup";
const ready = { state: "READY", canDelete: true, message: "원본 상태 확인 완료", databaseBytes: 1024, coverBytes: 2048, coverFiles: 2 };
const cleaned = { ...ready, state: "CLEANED", canDelete: false, message: "기존 DB와 표지가 없습니다. 새 책장 데이터는 유지됩니다." };
const panel = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "기존 데이터 정리", exact: true }) });

async function profile(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/profile");
}

test("cleanup state is rendered even when browser JavaScript cannot run", async ({ page, browser }) => {
  await profile(page);
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto(page.url());
    await expect(panel(staticPage).getByRole("status")).toHaveText("원클릭 이전 완료 후에 기존 데이터를 삭제할 수 있습니다.");
    await expect(panel(staticPage).getByRole("button", { name: "기존 DB·표지 삭제", exact: true })).toBeDisabled();
  } finally { await context.close(); }
});

test("cleanup refresh enables a ready source, respects cancellation and renders completed deletion", async ({ page }) => {
  await profile(page);
  let posts = 0;
  await page.route(endpoint, async (route) => {
    const post = route.request().method() === "POST";
    if (post) posts += 1;
    await route.fulfill({ json: post ? cleaned : ready });
  });
  await panel(page).getByRole("button", { name: "상태 다시 확인", exact: true }).click();
  await expect(panel(page).getByRole("status")).toHaveText(ready.message);
  const remove = panel(page).getByRole("button", { name: "기존 DB·표지 삭제", exact: true });
  await expect(remove).toBeEnabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await remove.click();
  expect(posts).toBe(0);
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(panel(page).getByRole("status")).toHaveText(cleaned.message);
  await expect(panel(page).getByRole("button", { name: "원본 삭제 완료", exact: true })).toBeDisabled();
  expect(posts).toBe(1);
});

test("cleanup reports failed or malformed status responses and recovers on retry", async ({ page }) => {
  await profile(page);
  let requests = 0;
  await page.route(endpoint, async (route) => {
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 503, contentType: "text/html", body: "upstream unavailable" });
    if (requests === 2) return route.fulfill({ json: { canDelete: true } });
    return route.fulfill({ json: cleaned });
  });
  const refresh = panel(page).getByRole("button", { name: "상태 다시 확인", exact: true });
  await refresh.click();
  await expect(panel(page).getByRole("status")).toContainText("원본 상태 요청에 실패했습니다.");
  await expect(panel(page).getByRole("button", { name: "기존 DB·표지 삭제", exact: true })).toBeDisabled();
  await refresh.click();
  await expect(panel(page).getByRole("status")).toContainText("원본 상태 응답을 확인할 수 없습니다.");
  await refresh.click();
  await expect(panel(page).getByRole("button", { name: "원본 삭제 완료", exact: true })).toBeDisabled();
});

test("cleanup status timeout leaves a retry action instead of an endless loading message", async ({ page }) => {
  await profile(page);
  await page.clock.install();
  await page.route(endpoint, () => { /* Hold the read request until the client timeout. */ });
  const pending = page.waitForRequest((request) => request.url().endsWith("/api/migration/legacy-cleanup"));
  await panel(page).getByRole("button", { name: "상태 다시 확인", exact: true }).click();
  await pending;
  await expect(panel(page).getByRole("button", { name: "상태 확인 중", exact: true })).toBeDisabled();
  await page.clock.fastForward(15_001);
  await expect(panel(page).getByRole("status")).toContainText("원본 상태 확인이 지연되고 있습니다.");
  await expect(panel(page).getByRole("button", { name: "상태 다시 확인", exact: true })).toBeEnabled();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route(endpoint, (route) => route.fulfill({ json: cleaned }));
  await panel(page).getByRole("button", { name: "상태 다시 확인", exact: true }).click();
  await expect(panel(page).getByRole("status")).toHaveText(cleaned.message);
});
