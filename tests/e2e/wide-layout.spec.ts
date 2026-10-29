import { openBookEditor } from "./helpers/book-editor";
import { expect, test } from "@playwright/test";

test("wide screens use more space without enlarging covers or breaking editing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "This test compares desktop viewport sizes directly.");
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const routes = ["/dashboard", "/books", "/books/1", "/products", "/inventory", "/inventory/branches/SEOUL", "/profile", "/aladin/search", "/aladin/used"];
  const content = page.locator(".page").filter({ has: page.getByRole("heading", { level: 1 }) });
  for (const route of routes) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(route);
    await expect(content).toBeVisible();
    const fhd = await content.boundingBox();
    expect(fhd?.width, `${route} FHD width`).toBeCloseTo(1380, 0);
    const cover = route === "/books" ? await page.locator(".book-card").first().boundingBox() : null;
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect.poll(async () => (await content.boundingBox())!.width, { message: `${route} should use the wider viewport` }).toBeGreaterThan(fhd!.width * 1.3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} overflow`).toBe(true);
    if (cover) {
      const wideCover = await page.locator(".book-card").first().boundingBox();
      expect(wideCover!.width).toBeLessThan(cover.width * 1.15);
    }
  }

  await page.goto("/books/1");
  await page.locator(".volume-card").first().getByRole("button", { name: "상세정보", exact: true }).click();
  const details = page.getByRole("dialog");
  await expect(details.getByLabel("권 제목", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await details.getByRole("button", { name: "상세정보 닫기", exact: true }).click();
  await expect(page.getByLabel("모든 권 선택", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/삭제 선택/)).toHaveCount(await page.locator(".volume-card").count());
  await page.getByLabel("모든 권 선택", { exact: true }).check();
  await expect(page.getByRole("button", { name: /^선택한 권 삭제/ })).toBeEnabled();
  await page.getByLabel("모든 권 선택", { exact: true }).uncheck();
  await openBookEditor(page);
  await expect(page.locator(".book-edit-form").getByLabel("제목", { exact: true })).toBeVisible();
});
