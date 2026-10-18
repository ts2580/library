import { expect, test } from "@playwright/test";

test("all Aladin filters survive initial search, form submission, paging and registration", async ({ page }, info) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const query = `상세필터검증 ${info.project.name}`;
  const filters = { queryType: "Publisher", searchTarget: "Foreign", sort: "SalesPoint", maxResults: "10", cover: "None", recentPublishFilter: "3", categoryId: "123", outOfStockFilter: "true" };
  await page.goto(`/aladin/search?${new URLSearchParams({ query, ...filters })}`);
  await expect(page.locator(".search-result-card")).toHaveCount(2);
  await expect(page.getByLabel("검색 기준", { exact: true })).toHaveValue("Publisher");
  await page.getByText("검색 조건", { exact: true }).click();
  for (const [name, value] of Object.entries({ "검색 대상": "Foreign", "정렬": "SalesPoint", "페이지당 결과": "10", "최근 출간 개월 (0: 전체)": "3", "알라딘 카테고리 ID": "123", "표지 크기": "None" })) {
    await expect(page.getByLabel(name, { exact: true })).toHaveValue(value);
  }
  await expect(page.getByLabel("품절 도서 제외", { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.locator(".search-result-card")).toHaveCount(2);
  const paging = page.waitForRequest(req => req.url().includes("/api/aladin/search?") && new URL(req.url()).searchParams.get("page") === "2");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  const params = new URL((await paging).url()).searchParams;
  for (const [key, value] of Object.entries(filters)) expect(params.get(key)).toBe(value);
  await page.getByLabel("선택 선택 샘플 2-1", { exact: true }).check();
  const registration = page.waitForRequest(req => req.url().endsWith("/api/aladin/import") && req.method() === "POST");
  await page.getByRole("button", { name: "1권 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "새 책 카테고리", exact: true });
  await dialog.getByRole("combobox", { name: "카테고리", exact: true }).selectOption("none");
  await dialog.getByRole("button", { name: "1권 추가", exact: true }).click();
  expect((await registration).postDataJSON().searchOptions).toMatchObject({ ...filters, maxResults: 10, recentPublishFilter: 3, categoryId: 123, outOfStockFilter: true });
  await expect(page.getByRole("heading", { level: 1, name: query })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books\?/);
  await page.goto("/aladin/search?query=키워드&queryType=Keyword");
  await expect(page.getByLabel("검색 기준", { exact: true })).toHaveValue("Keyword");
  await expect(page.locator(".search-result-card")).toHaveCount(2);
  await page.goto("/aladin/search?query=잘못된조건&maxResults=999");
  await expect(page.locator(".flash-error")).toContainText("검색 조건");
  await expect(page.locator(".search-result-card")).toHaveCount(0);
});
