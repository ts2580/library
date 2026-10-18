import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-pagination");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("books, owned volumes, inventory and branches retain filters with five numbered page links", async ({ page }) => {
  await login(page);
  for (const [url, label, parameter, filter] of [
    ["/books?title=페이지", "책 목록 페이지", "page", "title"],
    ["/products?ownedQ=페이지&ownedSort=name", "보유 권 페이지", "ownedPage", "ownedQ"],
    ["/inventory?q=페이지", "재고 페이지", "page", "q"],
    ["/inventory/branches/PAGING?q=페이지", "재고 페이지", "page", "q"]
  ]) {
    await page.goto(url);
    const nav = page.getByRole("navigation", { name: label, exact: true });
    await expect(nav.getByRole("link", { name: /^\d+페이지$/ })).toHaveText(["1", "2", "3", "4", "5"]);
    await expect(nav.getByRole("button", { name: "이전 페이지", exact: true })).toBeDisabled();
    await nav.getByRole("link", { name: "5페이지", exact: true }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveText("5");
    expect(new URL(page.url()).searchParams.get(filter)).toBe("페이지");
    if (parameter === "ownedPage") expect(new URL(page.url()).searchParams.get("ownedSort")).toBe("name");
    await nav.getByRole("link", { name: "다음 페이지", exact: true }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveText("6");
    expect(new URL(page.url()).searchParams.get(parameter)).toBe("6");
    await expect(nav.getByRole("link", { name: /^\d+페이지$/ })).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test("Aladin search, manual preview and quick add jump to numbered pages", async ({ page }, testInfo) => {
  await login(page);
  for (const mode of ["search", "manual", "quick"] as const) {
    const query = `페이지검증 ${mode} ${testInfo.project.name}`;
    if (mode === "search") await page.goto(`/aladin/search?query=${encodeURIComponent(query)}`);
    else if (mode === "manual") {
      await page.goto("/books");
      await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
      await page.getByRole("dialog").getByLabel("제목", { exact: true }).fill(query);
      await page.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
    } else await page.goto(`/products?q=${encodeURIComponent(query)}`);
    const nav = page.getByRole("navigation", { name: mode === "quick" ? "알라딘 한 권 검색 페이지" : "알라딘 검색 페이지", exact: true });
    await expect(nav.getByRole("button", { name: /^\d+페이지$/ })).toHaveText(["1", "2", "3", "4", "5"]);
    const response = page.waitForResponse(r => r.url().includes("/api/aladin/search?") && new URL(r.url()).searchParams.get("page") === "5");
    await nav.getByRole("button", { name: "5페이지", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("5");
    await expect(nav.getByRole("button", { name: /^\d+페이지$/ })).toHaveText(["3", "4", "5", "6", "7"]);
    await nav.getByRole("button", { name: "다음 페이지", exact: true }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveText("6");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-pagination.png`), fullPage: true });
  }
});
