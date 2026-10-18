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

test("repeated assembly errors stop automatic retries and allow a manual status check", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => sessionStorage.setItem("bookshelf.cover-restore-job", "assembly-retry-job"));
  let attempts = 0;
  let recovered = false;
  await page.route("**/api/backup/covers/uploads/assembly-retry-job/status", (route) => route.fulfill({ json: {
    status: recovered ? "COMPLETED" : "UPLOADING", percent: 100, totalChunks: 1, uploadedChunks: 1,
    completed: recovered, message: recovered ? "수동 확인으로 복원 완료" : "전송 완료"
  } }));
  await page.route("**/api/backup/covers/uploads/assembly-retry-job/complete", (route) => {
    attempts += 1;
    return route.fulfill({ status: 503, json: { message: "일시적인 조립 요청 실패" } });
  });
  await page.goto("/profile");
  const retry = page.getByRole("button", { name: "작업 상태 다시 확인", exact: true });
  await expect(retry).toBeVisible({ timeout: 13_000 });
  expect(attempts).toBe(3);
  expect(await page.evaluate(() => sessionStorage.getItem("bookshelf.cover-restore-job"))).toBe("assembly-retry-job");
  recovered = true;
  await retry.click();
  await expect(page.getByText("수동 확인으로 복원 완료", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("bookshelf.cover-restore-job"))).toBeNull();
});

test("a stalled initial assembly response falls back to the saved job status", async ({ page }) => {
  await login(page);
  await page.route("**/api/backup/covers/uploads", (route) => route.fulfill({ status: 201, json: { uploadId: "assembly-timeout-job" } }));
  await page.route("**/api/backup/covers/uploads/assembly-timeout-job/chunks/0", (route) => route.fulfill({ json: {} }));
  // Leave the response pending: the browser must bound the request and query status.
  await page.route("**/api/backup/covers/uploads/assembly-timeout-job/complete", () => {});
  await page.route("**/api/backup/covers/uploads/assembly-timeout-job/status", (route) => route.fulfill({ json: {
    status: "COMPLETED", percent: 100, totalChunks: 1, uploadedChunks: 1, completed: true, message: "응답 지연 후 복원 완료"
  } }));
  await page.goto("/profile");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "표지 업로드", exact: true }).click()]);
  await chooser.setFiles({ name: "fixture.zip", mimeType: "application/zip", buffer: Buffer.from("fixture") });
  await expect(page.getByText("응답 지연 후 복원 완료", { exact: true })).toBeVisible({ timeout: 18_000 });
  await expect(page.getByRole("button", { name: "표지 업로드", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("bookshelf.cover-restore-job"))).toBeNull();
});

test("mobile volume editing uses a dialog with enough width for the form", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page); await page.goto("/books/1");
  const card = page.locator(".volume-card").first();
  await card.getByRole("button", { name: "상세정보", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const cardBox = await card.boundingBox();
  const formBox = await dialog.locator(".entity-edit-fields").boundingBox();
  expect(cardBox).not.toBeNull(); expect(formBox).not.toBeNull();
  expect(formBox!.width).toBeGreaterThan(cardBox!.width * 0.65);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
