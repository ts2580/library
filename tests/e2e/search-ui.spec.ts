import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("manual add tabs separate ISBN-free entry and keep the preview action on the right", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "책 직접 추가", exact: true });
  const aladin = modal.getByRole("tab", { name: "알라딘 검색", exact: true });
  const manual = modal.getByRole("tab", { name: "책 수동 추가", exact: true });
  await expect(aladin).toHaveAttribute("aria-selected", "true");
  await expect(modal.getByRole("tabpanel", { name: "알라딘 검색", exact: true })).toBeVisible();
  const preview = modal.getByRole("button", { name: "추가 예정 확인", exact: true });
  const actions = await modal.locator(".manual-book-actions").boundingBox();
  const button = await preview.boundingBox();
  expect(button!.x + button!.width).toBeCloseTo(actions!.x + actions!.width, 0);
  const metadata = ["저자", "총 권수", "설명", "표지 URL", "표지 파일"];
  for (const label of metadata) await expect(modal.getByLabel(label, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("aladin-tab.png"), fullPage: true });
  await aladin.focus();
  await page.keyboard.press("ArrowRight");
  await expect(manual).toBeFocused();
  await expect(manual).toHaveAttribute("aria-selected", "true");
  await expect(modal.getByRole("tabpanel", { name: "책 수동 추가", exact: true })).toBeVisible();
  for (const label of metadata) await expect(modal.getByLabel(label, { exact: true })).toBeVisible();
  await expect(modal.getByRole("combobox", { name: "기존 책 검색", exact: true })).toHaveCount(0);
  await expect(modal.getByLabel(/ISBN/)).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "책 추가", exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("manual-tab.png"), fullPage: true });
  await manual.focus();
  await page.keyboard.press("Home");
  await expect(aladin).toBeFocused();
  await expect(aladin).toHaveAttribute("aria-selected", "true");
  await page.mouse.click(4, 4);
  await expect(modal).toBeHidden();
  await expect(page.getByRole("button", { name: "책 직접 추가", exact: true })).toBeFocused();
});

test("manual preview recovers a dropped request and keeps the selected book after persistent failures", async ({ page }) => {
  await login(page);
  await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "책 직접 추가", exact: true });
  const target = modal.getByRole("combobox", { name: "기존 책 검색", exact: true });
  await target.fill("마이그레이션");
  await modal.getByRole("option").filter({ hasText: "마이그레이션 테스트 책" }).click();
  for (const label of ["저자", "총 권수", "설명", "표지 URL", "표지 파일"]) await expect(modal.getByLabel(label, { exact: true })).toHaveCount(0);

  let mode: "recover" | "offline" | "gateway" | "online" = "recover";
  const requests: string[] = [];
  await page.route("**/api/aladin/search?**", async (route) => {
    requests.push(route.request().url());
    if (mode === "offline" || (mode === "recover" && requests.length === 1)) await route.abort("failed");
    else if (mode === "gateway") await route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>" });
    else await route.continue();
  });
  await modal.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  await expect(modal.locator(".search-result-card")).toHaveCount(2);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  await expect(modal.getByRole("alert")).toHaveCount(0);

  for (const failure of ["offline", "gateway"] as const) {
    mode = failure;
    const previous = requests.length;
    const retry = modal.getByRole("button", { name: "다시 검색", exact: true });
    await (await retry.count() ? retry : modal.getByRole("button", { name: "추가 예정 확인", exact: true })).click();
    await expect(modal.getByRole("alert")).toContainText(failure === "offline" ? "알라딘 검색 서버에 연결하지 못했습니다" : "HTTP 502");
    expect(requests).toHaveLength(previous + 2);
    await expect(target).toHaveValue("마이그레이션 테스트 책");
    await expect(modal.getByLabel("제목", { exact: true })).toHaveValue("마이그레이션 테스트 책");
    await expect(modal.getByRole("button", { name: "추가 예정 확인", exact: true })).toBeEnabled();
  }
  mode = "online";
  await modal.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  await expect(modal.locator(".search-result-card")).toHaveCount(2);
  await expect(modal.getByRole("alert")).toHaveCount(0);
  await expect(target).toHaveValue("마이그레이션 테스트 책");
});

test("Aladin search uses the bookshelf filter layout and resets the keyword, criterion, and book target", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/aladin/search?query=reset&queryType=Author");
  const form = page.locator(".aladin-search-form");
  const criterion = form.getByRole("combobox", { name: "검색 기준", exact: true });
  const keyword = form.getByLabel("검색어", { exact: true });
  const target = page.getByRole("combobox", { name: "기존 책 검색", exact: true });
  const input = await keyword.boundingBox();
  const button = await form.getByRole("button", { name: "검색", exact: true }).boundingBox();
  const reset = form.getByRole("link", { name: "초기화", exact: true });
  expect(Math.abs(input!.y + input!.height - button!.y - button!.height)).toBeLessThan(1);
  await expect(form.getByLabel("분류", { exact: true })).toHaveCount(0);
  await expect(criterion).toHaveValue("Author");
  for (let attempt = 0; attempt < 2; attempt++) {
    await target.fill("마이그레이션");
    await page.getByRole("option").filter({ hasText: "마이그레이션 테스트 책" }).click();
    await criterion.selectOption("Author");
    await keyword.fill("검색 전 입력");
    await reset.click();
    await expect(page).toHaveURL(/\/aladin\/search$/);
    await expect(keyword).toHaveValue("");
    await expect(criterion).toHaveValue("Title");
    await expect(target).toHaveValue("");
    await expect(page.locator(".search-result-card")).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("aladin-search-filters.png"), fullPage: true });
});

test("simplified search keeps the selected database book across title and author searches", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/books");
  await expect(page.getByRole("link", { name: "보유 권 검색", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "알라딘 검색", exact: true })).toHaveCount(0);
  await page.goto("/aladin/search");
  const form = page.locator(".aladin-search-form");
  await expect(page.getByText("상세 검색 조건", { exact: true })).toHaveCount(0);
  expect(await form.evaluate((node) => Boolean(node.closest(".panel.panel-soft")))).toBe(true);
  await expect(form.getByRole("combobox")).toHaveCount(1);
  await expect(form.getByLabel("분류", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "ISBN 재고 조회", exact: true })).toHaveCount(0);
  await expect(page.locator(".aladin-page-header").getByRole("combobox", { name: "기존 책 검색", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "기존 책 검색", exact: true })).toHaveCount(1);
  await expect(form.getByRole("combobox").locator("option")).toHaveText(["제목", "저자"]);

  const input = page.getByRole("combobox", { name: "기존 책 검색", exact: true });
  const lookup = page.waitForResponse((response) => response.url().includes("/api/books/options?query="));
  await input.fill("마이그레이션");
  expect((await lookup).status()).toBe(200);
  const option = page.getByRole("option").filter({ hasText: "마이그레이션 테스트 책" });
  await expect(option.getByRole("img")).toBeVisible();
  await option.click();
  const documents: string[] = [];
  page.on("request", (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  for (const queryType of ["Author", "Title"]) {
    const query = `대상 유지 ${queryType} ${testInfo.project.name}`;
    await form.getByLabel("검색어", { exact: true }).fill(query);
    await form.getByLabel("검색 기준", { exact: true }).selectOption(queryType);
    await form.getByRole("button", { name: "검색", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("queryType")).toBe(queryType);
    expect(new URL(page.url()).searchParams.get("bookId")).toBe("1");
    await expect(input).toHaveValue("마이그레이션 테스트 책");
    await expect(page.getByLabel("새 책 제목", { exact: true })).toHaveCount(0);
    await expect(page.locator(".search-result-card")).toHaveCount(2);
  }
  expect(documents).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("simplified-search.png"), fullPage: true });
  await page.getByRole("button", { name: "새 책으로 등록", exact: true }).click();
  await expect(input).toHaveValue("");
  await form.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page).not.toHaveURL(/bookId=/);
  await expect(page.getByLabel("새 책 제목", { exact: true })).toBeVisible();
});

test("Aladin pagination stays centered beside the right-aligned import action", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/aladin/search?query=footer");
  await expect(page.getByLabel("선택한 모든 권을 외전·특별판으로 추가")).toHaveCount(0);
  for (const width of [1440, 412, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const footer = await page.locator(".aladin-results-footer").boundingBox();
    const pager = await page.getByRole("navigation", { name: "알라딘 검색 페이지", exact: true }).boundingBox();
    const action = await page.getByRole("button", { name: "0권 추가", exact: true }).boundingBox();
    expect(Math.abs(pager!.x + pager!.width / 2 - footer!.x - footer!.width / 2)).toBeLessThan(1);
    expect(Math.abs(action!.x + action!.width - footer!.x - footer!.width)).toBeLessThan(1);
    expect(Math.abs(action!.y + action!.height / 2 - pager!.y - pager!.height / 2)).toBeLessThan(1);
    expect(action!.x).toBeGreaterThanOrEqual(pager!.x + pager!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`aladin-footer-${width}.png`), fullPage: true });
  }
});

test("Korean composition confirmation does not search, register, or reset the current selection", async ({ page }) => {
  await login(page);
  await page.goto("/aladin/search?query=composition");
  const url = page.url();
  await page.getByLabel("선택 선택 샘플 1-1", { exact: true }).check();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/aladin/search?") || request.url().includes("/api/aladin/import")) requests.push(request.url());
  });
  const session = await page.context().newCDPSession(page);
  for (const field of [page.getByLabel("검색어", { exact: true }), page.getByLabel("새 책 제목", { exact: true }), page.getByRole("combobox", { name: "기존 책 검색", exact: true })]) {
    await field.focus();
    await session.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
    await page.keyboard.press("Enter");
    await session.send("Input.insertText", { text: "한" });
  }
  // Allow an unintended submission, navigation, or delayed lookup to finish.
  await page.waitForTimeout(1500);
  expect(requests).toEqual([]);
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel("선택 선택 샘플 1-1", { exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "1권 추가", exact: true })).toBeEnabled();
  await session.detach();
});

test("a slower old database lookup cannot replace the latest autocomplete results", async ({ page }) => {
  await login(page);
  await page.goto("/aladin/search");
  const releases: Array<() => void> = [];
  await page.route("**/api/books/options?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query === "이전") await new Promise<void>((resolve) => releases.push(resolve));
    await route.fulfill({ json: [{ id: query === "이전" ? 10 : 11, name: `${query} 결과`, author: "저자", type: "소설", cover: null, nextVolume: 2 }] });
  });
  const input = page.getByRole("combobox", { name: "기존 책 검색", exact: true });
  await input.fill("이전");
  await expect.poll(() => releases.length).toBe(1);
  await input.fill("최신");
  await expect(page.getByRole("option").filter({ hasText: "최신 결과" })).toBeVisible();
  releases.forEach((resolve) => resolve());
  await input.press("Enter");
  await expect(input).toHaveValue("최신 결과");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("new-book registration asks for a category and retains selection across cancellation and a failed save", async ({ page }, testInfo) => {
  await login(page);
  const name = `검색 카테고리 확인 ${testInfo.project.name}`;
  const category = `검색 등록 분류 ${testInfo.project.name}`;
  await page.goto(`/aladin/search?query=${encodeURIComponent(name)}`);
  await page.getByLabel("선택 선택 샘플 1-1", { exact: true }).check();
  const requests: Array<{ category?: string }> = [];
  let fail = true;
  await page.route("**/api/aladin/import", async route => {
    requests.push(route.request().postDataJSON());
    if (fail) await route.fulfill({ status: 503, json: { message: "등록 재시도 확인" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "1권 추가", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "새 책 카테고리", exact: true });
  const select = modal.getByRole("combobox", { name: "카테고리", exact: true });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "1권 추가", exact: true }).click();
  expect(await select.evaluate(node => (node as HTMLSelectElement).checkValidity())).toBe(false);
  expect(requests).toHaveLength(0);
  await modal.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByLabel("선택 선택 샘플 1-1", { exact: true })).toBeChecked();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "1권 추가", exact: true }).click();
  await select.selectOption("add");
  await modal.getByLabel("새 카테고리 이름", { exact: true }).fill(category);
  await modal.getByRole("button", { name: "추가", exact: true }).click();
  await expect(select).toHaveValue(`saved:${category}`);
  await modal.getByRole("button", { name: "1권 추가", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("등록 재시도 확인");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.category).toBe(category);
  await expect(select).toHaveValue(`saved:${category}`);
  fail = false;
  await modal.getByRole("button", { name: "1권 추가", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  await expect(page.locator(".book-hero")).toContainText(category);
  await expect(page.locator(".book-edit-form").getByRole("combobox", { name: "카테고리", exact: true })).toHaveValue(`saved:${category}`);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books(?:\?|$)/);
});
