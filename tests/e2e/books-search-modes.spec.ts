import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username = "fixture-admin") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("bookshelf separates series search from volume ISBN search and preserves the detail return context", async ({ page }) => {
  await login(page);
  await page.goto("/books");
  const modes = page.getByRole("navigation", { name: "책장 검색 방식" });
  const form = page.locator(".books-search-form");
  await expect(modes.getByRole("link", { name: "일반 책 검색", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(form.getByLabel("검색 기준").locator("option")).toHaveText(["제목", "저자"]);
  await form.getByLabel("검색어", { exact: true }).fill("테스트 1권");
  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("조건에 맞는 책이 없습니다.", { exact: true })).toBeVisible();
  await modes.getByRole("link", { name: "책 상세 검색", exact: true }).click();
  await expect(form.getByLabel("검색 기준").locator("option")).toHaveText(["제목", "저자", "ISBN"]);
  await form.getByLabel("검색 기준").selectOption("isbn");
  await form.getByLabel("검색어", { exact: true }).fill("9780000000001");
  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page).toHaveURL(/isbn=9780000000001/);
  await expect(page.locator(".stock-card")).toHaveCount(1);
  await expect(page.locator(".stock-card")).toContainText("테스트 1권");
  const origin = page.url();
  await page.getByRole("link", { name: "테스트 1권", exact: true }).click();
  await page.getByRole("link", { name: "← 이전 목록", exact: true }).click();
  await expect(page).toHaveURL(origin);
  await expect(form.getByLabel("검색 기준")).toHaveValue("isbn");
  await form.getByLabel("검색어", { exact: true }).fill("9780000000002");
  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("조건에 맞는 권이 없습니다.", { exact: true })).toBeVisible();
  await form.getByRole("link", { name: "초기화", exact: true }).click();
  await expect(page).toHaveURL(/\/books\?mode=detail$/);
  await expect(form.getByLabel("검색 기준")).toHaveValue("title");
  await expect(form.getByLabel("검색어", { exact: true })).toHaveValue("");
  await expect(modes.getByRole("link", { name: "책 상세 검색", exact: true })).toHaveAttribute("aria-current", "page");
});

test("ISBN-free volume results retain search mode through paging, refresh, reset and browser back", async ({ page }, testInfo) => {
  await login(page, "fixture-pagination");
  await page.goto("/books?mode=detail");
  const form = page.locator(".books-search-form");
  await form.getByLabel("검색어", { exact: true }).fill("페이지 권");
  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.locator(".stock-card")).toHaveCount(20);
  await expect(page.locator(".stock-card").first()).toContainText("ISBN 없음");
  const pager = page.getByRole("navigation", { name: "책 목록 페이지", exact: true });
  await pager.getByRole("link", { name: "다음 페이지", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(new URL(page.url()).searchParams.get("mode")).toBe("detail");
  expect(new URL(page.url()).searchParams.get("title")).toBe("페이지 권");
  await page.reload();
  await expect(form.getByLabel("검색어", { exact: true })).toHaveValue("페이지 권");
  await expect(page.locator(".stock-card")).toHaveCount(20);
  await page.screenshot({ path: testInfo.outputPath("books-detail-search.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("navigation", { name: "책장 검색 방식" }).getByRole("link", { name: "일반 책 검색", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(24);
  await page.goBack();
  await expect(page).toHaveURL(/mode=detail.*page=2/);
  await expect(page.locator(".stock-card")).toHaveCount(20);
  await form.getByLabel("검색 기준").selectOption("author");
  await form.getByLabel("검색어", { exact: true }).fill("없는 저자");
  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("조건에 맞는 권이 없습니다.", { exact: true })).toBeVisible();
  await form.getByRole("link", { name: "초기화", exact: true }).click();
  await expect(page.locator(".stock-card")).toHaveCount(20);
});
