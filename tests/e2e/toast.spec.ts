import { openBookEditor } from "./helpers/book-editor";
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("redirect notifications float outside page layout and are consumed without losing search context", async ({ page }, testInfo) => {
  await login(page);
  const params = new URLSearchParams({ title: "테스트", page: "1", message: "수정 완료 " + "긴 알림 내용 ".repeat(12) });
  await page.goto(`/books?${params}#main-content`);
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  await expect(page.locator(".page .flash-success")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has("message")).toBe(false);
  expect(new URL(page.url()).searchParams.get("title")).toBe("테스트");
  expect(new URL(page.url()).searchParams.get("page")).toBe("1");
  expect(new URL(page.url()).hash).toBe("#main-content");
  const bounds = (await toast.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.locator(".toast-host").evaluate(element => getComputedStyle(element).position)).toBe("fixed");
  const before = await page.locator(".page").boundingBox();
  await page.screenshot({ path: testInfo.outputPath("completion-toast.png") });
  await toast.getByRole("button", { name: "알림 닫기" }).click();
  await expect(toast).toHaveCount(0);
  expect(await page.locator(".page").boundingBox()).toEqual(before);
  await page.reload();
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("repeated saves show a new toast and automatically dismiss it", async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
    const toast = page.locator(".toast").filter({ hasText: "프로필을 저장했습니다" });
    await expect(toast).toBeVisible();
    await expect(page).toHaveURL(/\/profile$/);
    await page.mouse.move(0, 0);
    await expect(toast).toHaveCount(0, { timeout: 8000 });
  }
});

test("detail editors omit cover URLs and retain the existing cover on save", async ({ page }) => {
  await login(page);
  await page.goto("/books/1");
  await expect(page.locator('input[name="coverUrl"]')).toHaveCount(0);
  const image = page.locator(".book-hero-cover img");
  const source = await image.getAttribute("src");
  expect(source).toBeTruthy();
  await openBookEditor(page);
  await page.locator(".book-edit-form").getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("책 정보를 저장했습니다");
  await expect(image).toHaveAttribute("src", source!);
  await openBookEditor(page);
  await expect(page.locator(".book-edit-form").getByLabel("표지 파일")).toBeVisible();
  await expect(page.locator('input[name="coverUrl"]')).toHaveCount(0);
  await page.getByRole("button", { name: "책 정보 수정 닫기", exact: true }).click();
  await page.locator(".volume-card").first().getByRole("button", { name: "상세정보", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("표지 URL")).toHaveCount(0);
  await expect(dialog.getByLabel("표지 파일")).toBeVisible();
});
