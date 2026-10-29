import { openBookEditor } from "./helpers/book-editor";
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
  await page.locator(".aladin-import-action").getByRole("button", { name: "1권 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "새 책 카테고리", exact: true });
  await dialog.getByRole("combobox", { name: "카테고리", exact: true }).selectOption("none");
  await dialog.getByRole("button", { name: "1권 추가", exact: true }).click();
  expect((await registration).postDataJSON().searchOptions).toMatchObject({ ...filters, maxResults: 10, recentPublishFilter: 3, categoryId: 123, outOfStockFilter: true });
  await expect(page.getByRole("heading", { level: 1, name: query })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await openBookEditor(page);
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/aladin\/search\?/);
  const restored = new URL(page.url()).searchParams;
  expect(restored.get("query")).toBe(query);
  expect(restored.get("page")).toBe("2");
  for (const [key, value] of Object.entries(filters)) {
    if (key === "outOfStockFilter") expect(["true", "on", "1"]).toContain(restored.get(key));
    else expect(restored.get(key), key).toBe(value);
  }
  await page.goto("/aladin/search?query=키워드&queryType=Keyword");
  await expect(page.getByLabel("검색 기준", { exact: true })).toHaveValue("Keyword");
  await expect(page.locator(".search-result-card")).toHaveCount(2);
  await page.goto("/aladin/search?query=잘못된조건&maxResults=999");
  await expect(page.locator(".flash-error")).toContainText("검색 조건");
  await expect(page.locator(".search-result-card")).toHaveCount(0);
});

for (const clear of [false, true]) {
  test(`existing-book auto-search preserves ${clear ? "cleared" : "newly edited"} filters before form submission`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const applied = { query: "검색결과없음필터", queryType: "Publisher", searchTarget: "Foreign", sort: "SalesPoint", maxResults: "10", recentPublishFilter: "3", categoryId: "123", cover: "None", outOfStockFilter: "true" };
    await page.goto(clear ? `/aladin/search?${new URLSearchParams(applied)}` : "/aladin/search");
    await expect(page.locator(".search-result-card")).toHaveCount(0);
    await page.getByText("검색 조건", { exact: true }).click();
    const edited = clear
      ? { searchTarget: "Book", sort: "Accuracy", maxResults: "25", recentPublishFilter: "0", categoryId: "", cover: "Big", outOfStockFilter: false }
      : { searchTarget: "Foreign", sort: "SalesPoint", maxResults: "10", recentPublishFilter: "3", categoryId: "123", cover: "None", outOfStockFilter: true };
    await page.getByLabel("검색 대상", { exact: true }).selectOption(edited.searchTarget);
    await page.getByLabel("정렬", { exact: true }).selectOption(edited.sort);
    await page.getByLabel("페이지당 결과", { exact: true }).fill(edited.maxResults);
    await page.getByLabel("최근 출간 개월 (0: 전체)", { exact: true }).fill(edited.recentPublishFilter);
    await page.getByLabel("알라딘 카테고리 ID", { exact: true }).fill(edited.categoryId);
    await page.getByLabel("표지 크기", { exact: true }).selectOption(edited.cover);
    await page.getByLabel("품절 도서 제외", { exact: true }).setChecked(edited.outOfStockFilter);
    await page.getByRole("combobox", { name: "기존 책 검색", exact: true }).fill("마이그레이션");
    await page.getByRole("option").filter({ hasText: "마이그레이션 테스트 책" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("bookId")).toBe("1");
    const params = new URL(page.url()).searchParams;
    for (const [key, value] of Object.entries(edited)) {
      if (key === "outOfStockFilter") expect(["on", "true"].includes(params.get(key) ?? "")).toBe(value);
      else expect(params.get(key)).toBe(value);
    }
    expect(params.get("query")).toBe("마이그레이션 테스트 책");
    expect(params.get("queryType")).toBe("Title");
    await expect(page.locator(".search-result-card")).toHaveCount(2);
    const paging = page.waitForRequest(req => req.url().includes("/api/aladin/search?") && new URL(req.url()).searchParams.get("page") === "2");
    await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
    const next = new URL((await paging).url()).searchParams;
    for (const [key, value] of Object.entries(edited)) {
      expect(next.get(key)).toBe(key === "categoryId" && !value ? null : String(value));
    }
  });
}
