import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username = "fixture-user") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("regular users can navigate from search to ISBN lookup", async ({ page }) => {
  await login(page); await page.goto("/aladin/search");
  await expect(page.getByRole("navigation").getByRole("link", { name: "재고", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "ISBN 재고 조회", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ISBN 재고 조회", exact: true })).toBeVisible();
  await page.getByLabel("ISBN10 또는 ISBN13", { exact: true }).fill("9780000000001");
  await page.getByLabel("재고 종류", { exact: true }).selectOption("offstore");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.locator(".branch-card")).toHaveCount(1);
});

test("book-detail search links initialize the title once and preserve explicit queries", async ({ page }) => {
  await login(page); await page.goto("/books/2");
  await expect(page.getByRole("link", { name: "알라딘에서 권 추가", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "알라딘에서 검색", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "알라딘에서 추가", exact: true })).toHaveCount(1);
  const addLink = page.locator(".volume-add-actions").getByRole("link", { name: "알라딘에서 추가", exact: true });
  await expect(addLink).toHaveAttribute("href", "/aladin/search?bookId=2");
  await addLink.click();
  await expect(page.getByLabel("검색어", { exact: true })).toHaveValue("다른 계정 비공개 도서");
  await expect(page.getByLabel("검색 기준", { exact: true })).toHaveValue("Title");
  await expect(page.locator(".search-result-card")).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "기존 책 검색", exact: true })).toHaveValue("다른 계정 비공개 도서");
  await page.goto("/aladin/search?bookId=2&query=explicit-author&queryType=Author");
  await expect(page.getByLabel("검색어", { exact: true })).toHaveValue("explicit-author");
  await expect(page.getByLabel("검색 기준", { exact: true })).toHaveValue("Author");
  await expect(page.locator(".search-result-card")).toHaveCount(2);
  await page.goto("/aladin/search?bookId=1");
  await expect(page.getByLabel("검색어", { exact: true })).toHaveValue("");
  await expect(page.locator(".search-result-card")).toHaveCount(0);
});
