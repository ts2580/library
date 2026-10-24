import { expect, test } from "@playwright/test";

test("overlapping lookups keep the top progress bar until failure or cancellation", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "책 직접 추가", exact: true });
  const bar = page.locator("#top-progress-bar");
  let finishPreview!: () => void;
  let finishLookup!: () => void;
  const preview = new Promise<void>(resolve => { finishPreview = resolve; });
  const lookup = new Promise<void>(resolve => { finishLookup = resolve; });
  await page.route("**/api/aladin/search?**", async route => {
    await preview;
    await route.fulfill({ status: 400, json: { message: "진행 막대 실패 검증" } });
  });
  await page.route("**/api/books/options?**", async route => {
    await lookup;
    await route.fulfill({ json: [] });
  });
  try {
    await modal.getByLabel("제목", { exact: true }).fill("진행 막대 검증");
    await modal.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
    await expect(bar).toBeVisible();
    await modal.getByLabel("기존 책 검색", { exact: true }).fill("없는 책");
    await expect(modal.getByRole("status").filter({ hasText: "기존 책 검색 중" })).toBeVisible();
    await expect(modal.getByLabel("기존 책 검색", { exact: true })).toBeFocused();
    await expect(bar).toHaveCSS("height", "3px");
    await expect(bar).toHaveCSS("pointer-events", "none");
    expect(await bar.evaluate(el => getComputedStyle(el, "::after").animationName)).toBe("top-progress-sweep");
    await page.screenshot({ path: testInfo.outputPath("top-progress-modal.png"), fullPage: true });
    finishLookup();
    await expect(modal.getByRole("status").filter({ hasText: "기존 책 검색 중" })).toHaveCount(0);
    await expect(bar).toBeVisible();
    finishPreview();
    await expect(modal.getByRole("alert")).toContainText("진행 막대 실패 검증");
    await expect(bar).toBeHidden();
    await page.getByRole("alertdialog").getByRole("button", { name: "확인", exact: true }).click();

    // An outstanding lookup must release its token when the dialog is closed.
    await page.unrouteAll({ behavior: "wait" });
    await page.route("**/api/books/options?**", async route => {
      await new Promise(resolve => setTimeout(resolve, 600));
      await route.fulfill({ json: [] });
    });
    await modal.getByLabel("기존 책 검색", { exact: true }).fill("취소 검증");
    await expect(bar).toBeVisible();
    await modal.getByRole("button", { name: "책 직접 추가 닫기", exact: true }).click();
    await expect(bar).toBeHidden();
    await page.unrouteAll({ behavior: "wait" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await bar.evaluate(el => getComputedStyle(el, "::after").animationName)).toBe("none");
  } finally {
    finishLookup(); finishPreview();
    await page.unrouteAll({ behavior: "wait" });
  }
});
