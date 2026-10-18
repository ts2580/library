import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username = "fixture-admin", password = "fixture-only-password") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function emptyBook(page: Page, name: string): Promise<number> {
  const response = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name, author: "", description: "", type: "", totalVolume: "", coverUrl: "" }, direct: true, targetBookId: null, selection: []
  }) } });
  expect(response.status()).toBe(201);
  return (await response.json()).bookId;
}

async function deleteCurrentBook(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books\?/);
}

test("book detail searches Aladin inline, saves explicit numbering and side stories, and edits the parent category", async ({ page }, testInfo) => {
  await login(page);
  const name = `상세 검색 복원 ${testInfo.project.name}`;
  const bookId = await emptyBook(page, name);
  await page.goto(`/books/${bookId}`);
  await page.getByRole("button", { name: "알라딘에서 검색", exact: true }).click();
  const panel = page.getByRole("region", { name: "알라딘 한 권 추가" });
  await panel.getByRole("button", { name: "알라딘 검색", exact: true }).click();
  const first = panel.locator(".quick-add-item").first();
  await first.getByLabel("권 번호", { exact: true }).fill("7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("detail-aladin-search.png"), fullPage: true });
  await first.getByRole("button", { name: "이 권 저장" }).click();
  await expect(first.locator(".flash-success")).toContainText("권을 추가");
  await expect(page.getByRole("heading", { name: "7권 · 선택 샘플 1-1", exact: true })).toBeVisible();
  const second = panel.locator(".quick-add-item").nth(1);
  await expect(second.getByLabel("권 번호", { exact: true })).toHaveValue("8");
  await second.getByLabel("외전·특별판", { exact: true }).check();
  await second.getByRole("button", { name: "이 권 저장" }).click();
  await expect(page.getByRole("heading", { name: "외전 · 선택 샘플 1-2", exact: true })).toBeVisible();
  const volume = page.locator(".volume-card").filter({ has: page.locator(".volume-title h3").filter({ hasText: "7권 · 선택 샘플 1-1" }) });
  await volume.getByRole("button", { name: "상세정보", exact: true }).click();
  await volume.getByLabel("책 카테고리", { exact: true }).fill("복원 분류");
  await volume.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".book-hero")).toContainText("복원 분류");
  await page.goto("/dashboard");
  await page.getByLabel("비교 기준", { exact: true }).selectOption("amount");
  await expect(page.locator(".category-row").filter({ hasText: "복원 분류" })).toContainText("2,000원");
  await page.goto(`/books/${bookId}`); await deleteCurrentBook(page);
});

test("product quick registration keeps the page and supports existing books and new-book metadata", async ({ page }, testInfo) => {
  await login(page);
  const name = `상품 대상 ${testInfo.project.name}`;
  const bookId = await emptyBook(page, name);
  await page.goto(`/products?q=${encodeURIComponent(`상품 검색 ${testInfo.project.name}`)}&aladinPage=2`);
  await expect(page).toHaveURL(/\/products\?/);
  const first = page.locator(".quick-add-item").first();
  await first.getByRole("combobox", { name: "기존 책 검색", exact: true }).fill(name);
  await first.getByRole("option").filter({ hasText: name }).click();
  await first.getByLabel("권 번호", { exact: true }).fill("9");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("product-quick-add.png"), fullPage: true });
  await first.getByRole("button", { name: "이 권 저장" }).click();
  await expect(first.locator(".flash-success")).toContainText("권을 추가");
  await expect(page).toHaveURL(/\/products\?/);
  const second = page.locator(".quick-add-item").nth(1);
  await second.getByLabel("카테고리", { exact: true }).fill("상품 분류");
  await second.getByLabel("총 권수", { exact: true }).fill("완결 15권");
  await second.getByRole("button", { name: "이 권 저장" }).click();
  await second.getByRole("link", { name: "추가한 책 보기" }).click();
  await expect(page.locator(".book-hero")).toContainText("상품 분류");
  await expect(page.locator(".book-hero")).toContainText("완결 15권");
  await deleteCurrentBook(page);
  await page.goto(`/books/${bookId}`);
  await expect(page.getByRole("heading", { name: "9권 · 선택 샘플 2-1", exact: true })).toBeVisible();
  await deleteCurrentBook(page);
});

test("used inventory restores source selection, minimum price and the corresponding raw JSON", async ({ page }) => {
  await login(page); await page.goto("/aladin/used?isbn13=123456789X&type=dropshipping");
  await expect(page.locator(".branch-card")).toHaveCount(1);
  await expect(page.locator(".branch-card")).toContainText("알라딘 직배송");
  await expect(page.getByText("1건 · 최저 2,300원", { exact: true })).toBeVisible();
  await page.getByLabel("재고 종류", { exact: true }).selectOption("offstore");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.locator(".branch-card")).toHaveCount(1);
  await expect(page.locator(".branch-card")).toContainText("갱신 서울점");
  await page.getByText("원본 JSON 응답", { exact: true }).click();
  await expect(page.locator(".raw-response")).toContainText("itemOffStoreList");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Java cover autocomplete works in search and direct-add with mouse and keyboard", async ({ page }, testInfo) => {
  await login(page);
  for (const url of ["/aladin/search", "/aladin/search?query=autocomplete", "/books"]) {
    await page.goto(url);
    if (url === "/books") await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
    await expect(page.getByLabel("등록 위치", { exact: true })).toHaveCount(0);
    const input = page.getByRole("combobox", { name: "기존 책 검색", exact: true });
    await input.fill("마이그레이션");
    const option = page.getByRole("option").filter({ hasText: "마이그레이션 테스트 책" });
    await expect(option).toBeVisible();
    const cover = option.getByRole("img", { name: "마이그레이션 테스트 책 표지" });
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    await expect(option).toContainText("다음 2권");
    await expect.poll(() => option.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(url === "/books" ? "manual-autocomplete.png" : "aladin-autocomplete.png"), fullPage: true });
    if (url === "/books") { await input.press("ArrowDown"); await input.press("Enter"); }
    else await option.click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(input).toHaveValue("마이그레이션 테스트 책");
    await expect(page.getByText("선택됨 · 마이그레이션 테스트 책", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "새 책으로 등록", exact: true }).click();
    await expect(input).toHaveValue("");
    await input.fill("존재하지않는책");
    await expect(page.getByText("일치하는 기존 책이 없습니다.", { exact: false })).toBeVisible();
    await input.press("Escape");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.fill("다른 계정 비공개");
    await expect(page.getByText("일치하는 기존 책이 없습니다.", { exact: false })).toBeVisible();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(0);
  }
});

test("author search survives paging and selected-item registration", async ({ page }, testInfo) => {
  await login(page); await page.goto("/aladin/search");
  const query = `필터 회귀 ${testInfo.project.name}`;
  await page.getByLabel("검색어", { exact: true }).fill(query);
  await expect(page.getByText("상세 검색 조건", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "검색 기준", exact: true }).selectOption("Author");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page).toHaveURL(/queryType=Author/);
  const nextPage = page.waitForRequest((request) => request.url().includes("/api/aladin/search?") && new URL(request.url()).searchParams.get("page") === "2");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  const request = new URL((await nextPage).url());
  expect(request.searchParams.get("queryType")).toBe("Author");
  expect(request.searchParams.get("searchTarget")).toBe("Book");
  await page.getByLabel("선택 선택 샘플 2-1", { exact: true }).check();
  const importRequest = page.waitForRequest((request) => request.url().endsWith("/api/aladin/import") && request.method() === "POST");
  await page.getByRole("button", { name: "1권 추가", exact: true }).click();
  const categoryDialog = page.getByRole("dialog", { name: "새 책 카테고리", exact: true });
  await categoryDialog.getByRole("combobox", { name: "카테고리", exact: true }).selectOption("none");
  await categoryDialog.getByRole("button", { name: "1권 추가", exact: true }).click();
  expect((await importRequest).postDataJSON().searchOptions).toMatchObject({ queryType: "Author", searchTarget: "Book", sort: "PublishTime", outOfStockFilter: false });
  await expect(page.getByRole("heading", { level: 1, name: query })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books\?/);
});

test("cover regeneration reports success and invalid ISBN remains on the search page", async ({ page }) => {
  await login(page); await page.goto("/profile");
  await page.getByRole("button", { name: "미생성 표지 재생성", exact: true }).click();
  await expect(page).toHaveURL(/\/profile\?message=/);
  await expect(page.locator(".flash-success")).toContainText("커버 재생성 완료");
  await page.goto("/aladin/used?isbn=invalid");
  await expect(page.getByRole("heading", { name: "ISBN 재고 조회" })).toBeVisible();
  await expect(page.locator(".flash-error")).toContainText("ISBN10 또는 ISBN13");
  await page.goto("/aladin/used?isbn13=123456789X");
  await expect(page.getByRole("heading", { name: "조회 결과" })).toBeVisible();
});

test("legacy inventory links keep the selected branch and search", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/branches?search=100%25_!&page=2");
  await expect(page).toHaveURL(/\/inventory\?/);
  await expect(page.getByLabel("제목·ISBN·지점 검색")).toHaveValue("100%_!");
  await expect(page.locator(".stock-card")).toHaveCount(4);
  await page.goto("/dashboard/branches/detail?branch=SEOUL");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("서울점");
});

test("profile and password edits persist and revoke an already logged-in session", async ({ page, browser }) => {
  const second = await browser.newContext();
  try {
    const otherPage = await second.newPage();
    await login(page, "fixture-user"); await login(otherPage, "fixture-user");
    await page.goto("/profile");
    await page.getByLabel("이름", { exact: true }).fill("회귀 검사 사용자");
    await page.getByLabel("이메일", { exact: true }).fill("fixture@example.com");
    await page.getByRole("button", { name: "프로필 저장" }).click();
    await expect(page.locator(".flash-success")).toContainText("프로필을 저장했습니다");
    await expect(page.getByLabel("이름", { exact: true })).toHaveValue("회귀 검사 사용자");
    await page.getByLabel("현재 비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByLabel("새 비밀번호", { exact: true }).fill("fixture-changed-password");
    await page.getByLabel("새 비밀번호 확인", { exact: true }).fill("fixture-changed-password");
    await page.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
    await expect(page.locator(".flash-success")).toContainText("비밀번호를 변경");
    await otherPage.goto("/books"); await expect(otherPage).toHaveURL(/\/login/);
    await page.getByLabel("현재 비밀번호", { exact: true }).fill("fixture-changed-password");
    await page.getByLabel("새 비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByLabel("새 비밀번호 확인", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
    await expect(page.locator(".flash-success")).toContainText("비밀번호를 변경");
  } finally { await second.close(); }
});


test("book edits, side stories, purchase state, and individual deletion persist", async ({ page }, testInfo) => {
  await login(page);
  const name = `상세 회귀 ${testInfo.project.name}`;
  const response = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name, author: "", description: "", type: "", totalVolume: "", coverUrl: "" }, direct: true, targetBookId: null, selection: []
  }) } });
  expect(response.status()).toBe(201);
  const { bookId } = await response.json();
  await page.goto(`/books/${bookId}`);
  const bookForm = page.locator("form").filter({ has: page.getByRole("button", { name: "저장", exact: true }) });
  await bookForm.getByLabel("저자", { exact: true }).fill("수동 저자");
  await bookForm.getByLabel("총 권수", { exact: true }).fill("완결 12권");
  await bookForm.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".book-hero")).toContainText("수동 저자");
  for (const [title, special] of [["선택 샘플 1-1", false], ["외전 회귀", true]] as const) {
    const addDetails = page.getByRole("region", { name: "권 직접 추가", exact: true });
    if (!(await addDetails.isVisible())) await page.getByRole("button", { name: "직접 추가", exact: true }).click();
    const form = addDetails.locator("form");
    await form.getByLabel("권 제목", { exact: true }).fill(title);
    await form.getByLabel("외전·특별판", { exact: true }).setChecked(special);
    await form.getByRole("button", { name: "권 추가", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${special ? "외전" : "1권"} · ${title}`, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "저자/설명 넣기", exact: true })).toHaveCount(0);
  const volume = page.locator(".volume-card").filter({ has: page.locator(".volume-title h3").filter({ hasText: "1권 · 선택 샘플 1-1" }) });
  await volume.getByRole("button", { name: "상세정보", exact: true }).click();
  await volume.getByLabel("구매 완료", { exact: true }).check();
  await volume.getByLabel("저자", { exact: true }).press("Enter");
  await expect(volume.locator(".status-badge")).toHaveText("구매 완료");
  await expect(volume.getByRole("dialog")).toBeHidden();
  await expect(page.getByLabel("모든 권 선택", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/삭제 선택/)).toHaveCount(0);
  await volume.getByRole("button", { name: "상세정보", exact: true }).click();
  await volume.getByLabel("권 제목", { exact: true }).fill("");
  page.once("dialog", (dialog) => dialog.dismiss());
  await volume.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".volume-card")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await volume.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".volume-card")).toHaveCount(1);
  const remaining = page.locator(".volume-card").first();
  await remaining.getByRole("button", { name: "상세정보", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await remaining.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".volume-card")).toHaveCount(0);
  await expect(page.locator(".book-edit-form").getByLabel("총 권수", { exact: true })).toHaveValue("완결 12권");
  // Deletion must remain available even if the edit form contains invalid unsaved input.
  await page.locator(".book-edit-form").getByLabel("제목", { exact: true }).fill("");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books\?/);
});

test("profile categories can be added and removed while categories used by books are retained", async ({ page }, testInfo) => {
  await login(page);
  const category = `프로필 분류 ${testInfo.project.name}`;
  await page.goto("/profile");
  const panel = page.getByRole("region", { name: "카테고리 관리", exact: true });
  await panel.getByLabel("새 카테고리", { exact: true }).fill(category);
  await panel.getByRole("button", { name: "카테고리 추가", exact: true }).click();
  await expect(page.locator(".flash-success")).toContainText("카테고리를 추가");
  await page.reload();
  const row = panel.locator("li").filter({ has: page.getByText(category, { exact: true }) });
  await expect(row).toHaveCount(1);
  const response = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name: category, author: "", description: "", type: category, totalVolume: "", coverUrl: "" }, direct: true, targetBookId: null, selection: []
  }) } });
  expect(response.status()).toBe(201);
  const { bookId } = await response.json();
  page.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".flash-error")).toContainText("책에 사용 중인 카테고리");
  await expect(row).toHaveCount(1);
  await page.goto(`/books/${bookId}`);
  await expect(page.locator(".book-edit-form").getByRole("combobox", { name: "카테고리", exact: true })).toHaveValue(`saved:${category}`);
  await deleteCurrentBook(page);
  await page.goto("/profile");
  page.once("dialog", dialog => dialog.dismiss());
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(row).toHaveCount(1);
  page.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".flash-success")).toContainText("카테고리를 삭제");
  await page.reload();
  await expect(row).toHaveCount(0);
});

test("volume details modal keeps focus inside and resets unsaved edits when reopened", async ({ page }) => {
  await login(page);
  await page.goto("/books/1");
  const trigger = page.locator(".volume-card").first().getByRole("button", { name: "상세정보", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const modal = page.getByRole("dialog", { name: "1권 · 테스트 1권", exact: true });
  await expect(modal).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  const name = modal.getByLabel("권 제목", { exact: true });
  await name.fill("저장하지 않은 수정");
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Tab");
    expect(await modal.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await trigger.click();
  await expect(name).toHaveValue("테스트 1권");
  await name.click();
  await expect(modal).toBeVisible();
  const bounds = await name.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await expect(modal).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await trigger.click();
  await modal.getByRole("button", { name: "상세정보 닫기", exact: true }).click();
  await expect(trigger).toBeFocused();
});
