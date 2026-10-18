import { expect, test, type Page } from "@playwright/test";
import { rmSync } from "node:fs";
import path from "node:path";

async function login(page: Page, username = "fixture-admin") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("anonymous, expired-cookie, and disabled-signup requests remain safe", async ({ page, context }) => {
  await page.goto("/books"); await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/stock-refresh")).status()).toBe(401);
  expect((await page.request.post("/api/books/manual", { multipart: { payload: "{}" } })).status()).toBe(401);
  await context.addCookies([{ name: "bookshelf_session", value: "expired-fixture", url: "http://127.0.0.1:25648" }]);
  await page.goto("/books"); await expect(page).toHaveURL(/\/login/);
  await page.goto("/signup"); await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("현재 회원가입이 비활성화되어 있습니다.")).toBeVisible();
});

test("authenticated pages render on desktop and mobile without overflow", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  for (const route of ["/dashboard", "/books", "/books/1", "/products", "/inventory", "/inventory/branches/SEOUL", "/profile", "/aladin/search", "/aladin/used"]) {
    expect((await page.goto(route))?.status(), route).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route} overflow`).toBe(true);
  }
  if (testInfo.project.name === "mobile") await expect(page.getByRole("navigation", { name: "모바일 주 메뉴" })).toBeVisible();
  await page.goto("/profile");
  await page.screenshot({ path: testInfo.outputPath("profile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("inventory literal search preserves pagination and branch scope", async ({ page }) => {
  await login(page); await page.goto("/inventory");
  await page.getByLabel("제목·ISBN·지점 검색").fill("100%_!");
  await page.getByRole("button", { name: "재고 검색", exact: true }).click();
  await expect(page.locator(".stock-card")).toHaveCount(24);
  await page.getByRole("link", { name: "다음 페이지" }).click();
  await expect(page.locator(".stock-card")).toHaveCount(4);
  await page.goto("/inventory/branches/SEOUL?q=100%25_!");
  await expect(page.locator(".stock-card")).toHaveCount(24);
});

test("other-owner books, covers, and administrator actions are isolated", async ({ page }) => {
  await login(page, "fixture-user"); await page.goto("/books");
  await expect(page.getByText("다른 계정 비공개 도서", { exact: true })).toBeVisible();
  await expect(page.getByText("마이그레이션 테스트 책", { exact: true })).toHaveCount(0);
  // Next.js can stream the shell with HTTP 200 before rendering notFound().
  await page.goto("/books/1");
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다.", exact: true })).toBeVisible();
  await expect(page.getByText("마이그레이션 테스트 책", { exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/covers/1/fixture.webp")).status()).toBe(404);
  expect((await page.request.get("/api/covers/2/fixture.webp")).status()).toBe(200);
  expect((await page.request.post("/api/stock-refresh")).status()).toBe(403);
  expect((await page.request.get("/api/migration/legacy-cleanup")).status()).toBe(403);
  expect((await page.request.post("/api/migration/legacy-cleanup")).status()).toBe(403);
  expect((await page.request.delete("/api/stock-refresh")).status()).toBe(403);
  const payload = { book: { name: "변경 차단", author: "", description: "", type: "", totalVolume: "", coverUrl: "" }, direct: false, targetBookId: 1, selection: [] };
  expect((await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify(payload) } })).status()).toBe(404);
});

test("manual registration and volume Server Actions persist actual records", async ({ page }, testInfo) => {
  const aladinRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/aladin/")) aladinRequests.push(request.url()); });
  await login(page); await page.goto("/books");
  const trigger = page.getByRole("button", { name: "책 직접 추가", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("tab", { name: "책 수동 추가", exact: true }).click();
  const create = page.locator("form").filter({ has: page.getByRole("button", { name: "책 추가", exact: true }) });
  await expect(create.getByLabel(/ISBN/)).toHaveCount(0);
  const name = `직접 등록 ${testInfo.project.name}`;
  await create.getByLabel("제목", { exact: true }).fill(name);
  await create.getByLabel("저자", { exact: true }).fill("테스트 저자");
  await create.getByRole("button", { name: "책 추가", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("button", { name: "직접 추가", exact: true }).click();
  const add = page.locator("form").filter({ has: page.getByRole("button", { name: "권 추가", exact: true }) });
  await add.getByLabel("권 제목", { exact: true }).fill("직접 추가 1권");
  await add.getByLabel("권차", { exact: true }).fill("1");
  await add.getByRole("button", { name: "권 추가", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1권 · 직접 추가 1권", exact: true })).toBeVisible();
  await expect(page.locator(".volume-card .volume-meta")).not.toContainText("ISBN");
  await page.locator(".volume-card").getByRole("button", { name: "상세정보", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("ISBN13", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "상세정보 닫기", exact: true }).click();
  expect(aladinRequests).toEqual([]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books(?:\?|$)/);
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

test("manual categories can be created, selected, and reused without a book", async ({ page }, testInfo) => {
  await login(page); await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  await page.getByRole("tab", { name: "책 수동 추가", exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "책 추가", exact: true }) });
  const category = `저장한 분류 ${testInfo.project.name}`;
  const select = form.getByRole("combobox", { name: "카테고리", exact: true });
  expect(await select.locator("option").last().textContent()).toBe("카테고리 추가");
  await select.selectOption("add");
  await form.getByLabel("새 카테고리 이름", { exact: true }).fill(category);
  await form.getByRole("button", { name: "추가", exact: true }).click();
  await expect(select).toHaveValue(`saved:${category}`);
  await page.reload(); await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  await page.getByRole("tab", { name: "책 수동 추가", exact: true }).click();
  await expect(select.locator("option", { hasText: category })).toHaveCount(1);
  await select.selectOption(`saved:${category}`);
  const name = `카테고리 확인 ${testInfo.project.name}`;
  await form.getByLabel("제목", { exact: true }).fill(name);
  await form.getByRole("button", { name: "책 추가", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(category, { exact: true }).first()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books(?:\?|$)/);
});

test("multi-page selection survives a failed page request and preserves import order", async ({ page }, testInfo) => {
  await login(page); await page.goto(`/aladin/search?query=${testInfo.project.name}`);
  await page.getByLabel("선택 선택 샘플 1-1", { exact: true }).check();
  await page.route("**/api/aladin/search?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "페이지 로딩 실패" }) }));
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "페이지 로딩 실패" })).toHaveText("페이지 로딩 실패");
  await expect(page.getByRole("button", { name: "1권 추가", exact: true })).toBeEnabled();
  await page.unroute("**/api/aladin/search?**");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await page.getByLabel("선택 선택 샘플 2-2", { exact: true }).check();
  await page.getByLabel("선택 선택 샘플 2-1", { exact: true }).check();
  await expect(page.locator(".search-result-card").filter({ hasText: "선택 샘플 2-2" }).getByText("1권으로 추가", { exact: true })).toBeVisible();
  await expect(page.locator(".search-result-card").filter({ hasText: "선택 샘플 2-1" }).getByText("2권으로 추가", { exact: true })).toBeVisible();
  await page.getByLabel("새 책 제목", { exact: true }).fill(`선택 등록 ${testInfo.project.name}`);
  await page.getByRole("button", { name: "3권 추가", exact: true }).click();
  const categoryDialog = page.getByRole("dialog", { name: "새 책 카테고리", exact: true });
  await categoryDialog.getByRole("combobox", { name: "카테고리", exact: true }).selectOption("none");
  await categoryDialog.getByRole("button", { name: "3권 추가", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: `선택 등록 ${testInfo.project.name}` })).toBeVisible();
  await expect(page.locator(".volume-title h3")).toHaveText(["1권 · 선택 샘플 2-2", "2권 · 선택 샘플 2-1", "3권 · 선택 샘플 1-1"]);
  // The two projects share a fixture server; remove this test's ISBNs afterwards.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books(?:\?|$)/);
});

test("XLSX round-trip and ZIP chunk upload run with the real worker", async ({ page }) => {
  await login(page);
  const exported = await page.request.get("/api/backup/excel/export"); expect(exported.status()).toBe(200);
  const imported = await page.request.post("/api/backup/excel/import", { maxRedirects: 0, multipart: { backupFile: {
    name: "fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await exported.body()
  } } });
  expect(imported.status()).toBe(303);
  expect(imported.headers().location).toContain("/profile?message=");
  const archive = await page.request.get("/api/backup/covers/export"); expect(archive.status()).toBe(200);
  const buffer = await archive.body();
  // Remove only the generated fixture image so this proves restoration, not a no-op.
  const fixture = process.env.BOOKSHELF_E2E_DATA;
  if (!fixture || !path.basename(fixture).startsWith("bookshelf-e2e-")) throw new Error("Missing isolated E2E fixture");
  rmSync(path.join(fixture, "covers/1/fixture.webp"));
  expect((await page.request.get("/api/covers/1/fixture.webp")).status()).toBe(404);
  const created = await page.request.post("/api/backup/covers/uploads", { data: { filename: "fixture.zip", totalSize: buffer.length, totalChunks: 1 } });
  expect(created.status()).toBe(201);
  const { uploadId } = await created.json();
  expect((await page.request.put(`/api/backup/covers/uploads/${uploadId}/chunks/0`, { data: buffer, headers: { "content-type": "application/octet-stream" } })).status()).toBe(200);
  expect((await page.request.post(`/api/backup/covers/uploads/${uploadId}/complete`)).status()).toBe(202);
  await expect.poll(async () => (await (await page.request.get(`/api/backup/covers/uploads/${uploadId}/status`)).json()).status, { timeout: 20_000 }).toBe("COMPLETED");
  expect((await page.request.get("/api/covers/1/fixture.webp")).status()).toBe(200);
});

test("foreign-origin mutation requests are rejected", async ({ page }) => {
  await login(page);
  const response = await page.request.post("/api/stock-refresh", { headers: { origin: "https://untrusted.example" } });
  expect(response.status()).toBe(403);
  expect((await page.request.post("/api/books/manual", { headers: { origin: "https://untrusted.example" }, multipart: { payload: "{}" } })).status()).toBe(403);
  expect((await page.request.post("/api/migration/legacy-cleanup", { headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
});

async function deleteCurrentBook(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books(?:\?|$)/);
}

test("manual Aladin preview keeps category, multi-page selections, and individual side stories", async ({ page }, testInfo) => {
  await login(page); await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  const form = page.getByRole("region", { name: "책 직접 추가", exact: true });
  const name = `직접 검색 등록 ${testInfo.project.name}`;
  await form.getByLabel("제목", { exact: true }).fill(name);
  for (const label of ["저자", "총 권수", "설명", "표지 URL", "표지 파일"]) await expect(form.getByLabel(label, { exact: true })).toHaveCount(0);
  await form.getByLabel("카테고리", { exact: true }).selectOption("add");
  await form.getByLabel("새 카테고리 이름", { exact: true }).fill(`직접 검색 분류 ${testInfo.project.name}`);
  await form.getByRole("button", { name: "추가", exact: true }).click();
  await form.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  await expect(form.getByRole("button", { name: "2권 추가", exact: true })).toBeEnabled();
  await form.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await form.getByLabel("외전 선택 샘플 2-2", { exact: true }).check();
  await expect(form.locator(".search-result-card").filter({ hasText: "선택 샘플 2-1" }).getByText("1권으로 추가", { exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "4권 추가", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("manual-preview.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await form.getByRole("button", { name: "4권 추가", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.locator(".volume-title h3")).toHaveText(["1권 · 선택 샘플 2-1", "2권 · 선택 샘플 1-2", "3권 · 선택 샘플 1-1", "외전 · 선택 샘플 2-2"]);
  const editor = page.locator("form").filter({ has: page.getByRole("button", { name: "저장", exact: true }) });
  await expect(editor.getByLabel("저자", { exact: true })).toHaveValue("테스트 저자");
  await expect(editor.getByLabel("총 권수", { exact: true })).toHaveValue("");
  await expect(editor.getByRole("combobox", { name: "카테고리", exact: true })).toHaveValue(`saved:직접 검색 분류 ${testInfo.project.name}`);
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books(?:\?|$)/);
});

test("search page and manual preview both append to an existing series and exclude owned ISBNs", async ({ page }, testInfo) => {
  await login(page); await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  await page.getByRole("tab", { name: "책 수동 추가", exact: true }).click();
  const name = `기존 시리즈 ${testInfo.project.name}`;
  await page.getByLabel("제목", { exact: true }).last().fill(name);
  await page.getByLabel("총 권수", { exact: true }).fill("전 12권");
  await page.getByRole("button", { name: "책 추가", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const bookId = page.url().match(/books\/(\d+)/)![1];
  await page.getByRole("button", { name: "직접 추가", exact: true }).click();
  await page.getByLabel("권 제목", { exact: true }).fill("기존 4권");
  await page.getByLabel("권차", { exact: true }).fill("4");
  await page.getByRole("button", { name: "권 추가", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4권 · 기존 4권", exact: true })).toBeVisible();
  await page.goto(`/aladin/search?query=${encodeURIComponent(name)}&bookId=${bookId}`);
  await expect(page.getByLabel("기존 책 검색", { exact: true })).toHaveValue(name);
  await page.getByLabel("선택 선택 샘플 1-1", { exact: true }).check();
  await page.getByRole("button", { name: "1권 추가", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "새 책 카테고리", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "5권 · 선택 샘플 1-1", exact: true })).toBeVisible();
  await page.goto("/books"); await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  await page.getByLabel("기존 책 검색", { exact: true }).fill(name);
  await page.getByRole("option").filter({ hasText: name }).click();
  await expect(page.getByText("다음 정규 권차 6권부터 추가", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  await expect(page.getByLabel("선택 선택 샘플 1-1", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("선택 선택 샘플 1-2", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "1권 추가", exact: true }).click();
  await expect(page.getByRole("heading", { name: "6권 · 선택 샘플 1-2", exact: true })).toBeVisible();
  await expect(page.getByLabel("총 권수", { exact: true })).toHaveValue("전 12권");
  await deleteCurrentBook(page);
});

test("manual form resets after closing and supports empty-search fallback", async ({ page }, testInfo) => {
  await login(page); await page.goto("/books");
  const trigger = page.getByRole("button", { name: "책 직접 추가", exact: true });
  const modal = page.getByRole("dialog", { name: "책 직접 추가", exact: true });
  await trigger.click();
  await expect(modal).toBeVisible();
  expect(await modal.evaluate((element) => element.matches(":modal"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByLabel("기존 책 검색", { exact: true }).fill("마이그레이션");
  await page.getByRole("option").filter({ hasText: "마이그레이션 테스트 책" }).click();
  await modal.getByRole("button", { name: "책 직접 추가 닫기", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("region", { name: "책 직접 추가", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  await expect(page.getByLabel("기존 책 검색", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("등록 위치", { exact: true })).toHaveCount(0);
  const form = page.getByRole("region", { name: "책 직접 추가", exact: true });
  await expect(form.getByLabel("제목", { exact: true })).toHaveValue("");
  const name = `검색결과없음 ${testInfo.project.name}`;
  await form.getByLabel("제목", { exact: true }).fill(name);
  await form.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  await form.getByRole("button", { name: "책만 추가", exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await deleteCurrentBook(page);
});

test("all search forms and inline lookups show spinners while a request is pending", async ({ page }) => {
  await login(page);
  for (const [url, label, value, button] of [
    ["/books", "검색어", "spinner-books", "검색"],
    ["/products", "권 제목·ISBN", "spinner-volumes", "권 검색"],
    ["/aladin/search", "검색어", "spinner-aladin", "검색"],
    ["/aladin/used", "ISBN10 또는 ISBN13", "9780000000001", "조회"],
    ["/inventory", "제목·ISBN·지점 검색", "spinner-inventory", "재고 검색"],
    ["/inventory/branches/SEOUL", "제목·ISBN·지점 검색", "spinner-branch", "재고 검색"]
  ]) {
    await page.goto(url);
    await page.route(`**${url}?**`, async (route) => { await new Promise((resolve) => setTimeout(resolve, 600)); await route.continue(); });
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "검색 중" }).first(), url).toBeVisible();
    await expect(page.locator("form[aria-busy=true]")).toHaveCount(0);
    await page.unroute(`**${url}?**`);
  }
  await page.goto("/books"); await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  await page.route("**/api/books/options?**", async (route) => { await new Promise((resolve) => setTimeout(resolve, 600)); await route.continue(); });
  await page.getByLabel("기존 책 검색", { exact: true }).fill("마이그레이션");
  await expect(page.getByRole("status").filter({ hasText: "기존 책 검색 중" })).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: "마이그레이션 테스트 책" })).toBeVisible();
  await page.unroute("**/api/books/options?**");
  await page.route("**/api/aladin/search?**", async (route) => { await new Promise((resolve) => setTimeout(resolve, 600)); await route.continue(); });
  await page.getByRole("region", { name: "책 직접 추가", exact: true }).getByLabel("제목", { exact: true }).fill("spinner");
  await page.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "알라딘 검색 중" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2권 추가", exact: true })).toBeEnabled();
});

test("real stock worker refreshes inventory, progress, and visible results without a reload", async ({ page }, testInfo) => {
  await login(page, "fixture-stock"); await page.goto("/inventory");
  await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /워커 처리 대기 중|재고 갱신 중/ })).toBeVisible();
  await expect(page.getByText("재고 일괄 조회 완료:", { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".stock-card")).toHaveCount(2);
  await expect(page.getByText("갱신 서울점", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".kpi-status")).toHaveText("COMPLETED");
  const progress = await (await page.request.get("/api/stock-refresh")).json();
  expect(progress).toMatchObject({ status: "COMPLETED", processed: 1, total: 1, success: 1, empty: 0, fail: 0, percent: 100 });
  await page.screenshot({ path: testInfo.outputPath("stock-completed.png"), fullPage: true });
});
