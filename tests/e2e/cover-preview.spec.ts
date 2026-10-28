import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function setup(page: Page) {
  const cover = await sharp({ create: { width: 500, height: 710, channels: 3, background: "#315f52" } }).webp().toBuffer();
  await page.route("**/api/covers/**", route => route.fulfill({ contentType: "image/webp", body: cover }));
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/books?title=마이그레이션 테스트 책");
  const image = page.locator(".book-card-cover img").first();
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(500);
  return image;
}

test("cover preview restores hover and touch hold without disturbing cover links", async ({ page, isMobile }, testInfo) => {
  const image = await setup(page);
  const preview = page.locator(".cover-preview");
  const originalURL = page.url();
  const before = await image.boundingBox();
  const layout = await image.evaluate((element: HTMLImageElement) => ({ width: element.offsetWidth, height: element.offsetHeight }));
  const grid = await page.locator(".book-grid").boundingBox();
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    const point = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForTimeout(200);
    await expect(preview).toBeHidden();
    await expect(preview).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("touch-cover-preview.png") });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(preview).toBeHidden();
    await page.waitForTimeout(150);
    expect(page.url()).toBe(originalURL);

    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, x: point.x + 25 }] });
    await page.waitForTimeout(600);
    await expect(preview).toBeHidden();
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });

    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await expect(preview).toBeVisible();
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(preview).toBeHidden();
    await session.detach();
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await image.hover();
    await expect(preview).toBeVisible();
    const bounds = (await preview.boundingBox())!;
    expect(bounds.width).toBeGreaterThan(before!.width);
    expect(bounds.height).toBeGreaterThan(before!.height);
    expect(bounds.x).toBeGreaterThanOrEqual(17);
    expect(bounds.y).toBeGreaterThanOrEqual(17);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 17);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height - 17);
    expect(await image.evaluate((element: HTMLImageElement) => ({ width: element.offsetWidth, height: element.offsetHeight }))).toEqual(layout);
    expect(await page.locator(".book-grid").boundingBox()).toEqual(grid);
    await page.screenshot({ path: testInfo.outputPath("hover-cover-preview.png") });
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await page.mouse.move(0, 0);
    // Move the pointer directly: locator.hover() may scroll the animated card first.
    const target = (await image.boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await expect(preview).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(preview).toBeHidden();
    await image.click();
  }
  await expect(page).toHaveURL(/\/books\/1(?:\?|$)/);
  await expect(preview).toBeHidden();
  const hero = page.locator(".book-hero-cover img");
  await expect(hero).toBeVisible();
  if (!isMobile) {
    await hero.scrollIntoViewIfNeeded();
    await expect.poll(() => hero.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(500);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.move(0, 0);
    const target = (await hero.boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await expect(preview).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expect(preview).toBeHidden();
  }
});
