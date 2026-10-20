import { expect, test } from "@playwright/test";

test("a failed server search can be retried without reloading or losing the book target", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/aladin/search?bookId=1");

  const documents: string[] = [];
  page.on("request", request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  const form = page.locator(".aladin-search-form");
  const error = page.locator(".flash-error[role=alert]");
  await form.getByLabel("검색어", { exact: true }).fill(`검색재시도검증 ${testInfo.project.name}`);
  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(error).toContainText("알라딘 API가 요청을 거절했습니다");
  await expect(page.locator(".search-result-card")).toHaveCount(0);
  const failedUrl = page.url();

  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.locator(".search-result-card")).toHaveCount(2);
  await expect(page).toHaveURL(failedUrl);
  await expect(page.getByRole("combobox", { name: "기존 책 검색", exact: true })).toHaveValue("마이그레이션 테스트 책");
  await page.getByLabel("선택 선택 샘플 1-1", { exact: true }).check();
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await page.getByLabel("선택 선택 샘플 2-1", { exact: true }).check();
  await expect(page.locator(".aladin-import-action").getByRole("button", { name: "2권 추가", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "이전 페이지", exact: true }).click();
  await expect(page.getByLabel("선택 선택 샘플 1-1", { exact: true })).toBeChecked();
  await expect(page.locator(".aladin-import-action").getByRole("button", { name: "2권 추가", exact: true })).toBeEnabled();
  expect(documents).toEqual([]);
});
