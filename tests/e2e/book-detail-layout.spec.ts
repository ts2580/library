import { openBookEditor } from "./helpers/book-editor";
import { expect, test } from "@playwright/test";

test("book descriptions use the full editor width while the three actions stay in order", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const description = "책 설명이 편집 영역의 왼쪽부터 전체 너비를 사용해야 합니다. ".repeat(8);
  const response = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name: `상세 배치 ${testInfo.project.name}`, author: "배치 검증", description, type: "", totalVolume: "", coverUrl: "" },
    direct: true, targetBookId: null, selection: []
  }) } });
  expect(response.status()).toBe(201);
  const { bookId } = await response.json();
  await page.goto(`/books/${bookId}`);
  const editor = page.locator(".entity-edit-layout-book");
  await openBookEditor(page);
  const fields = page.locator(".book-edit-form .entity-edit-fields");
  await openBookEditor(page);
  const textarea = page.locator(".book-edit-form").getByLabel("설명", { exact: true });
  await expect(textarea).toHaveValue(description.trim());
  for (const width of [1440, 1920, 2560, 1024, 768, 412, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const outer = (await editor.boundingBox())!;
    const inner = (await fields.boundingBox())!;
    const input = (await textarea.boundingBox())!;
    expect(Math.abs(inner.x - outer.x), `${width}px: fields start at the left edge`).toBeLessThan(1);
    expect(Math.abs(inner.width - outer.width), `${width}px: fields fill the editor`).toBeLessThan(1);
    expect(Math.abs(input.x - outer.x), `${width}px: description starts at the left edge`).toBeLessThan(1);
    expect(Math.abs(input.width - outer.width), `${width}px: description fills the editor`).toBeLessThan(1);
    const hero = page.locator(".book-hero");
    const title = (await hero.locator("h1").boundingBox())!;
    const summary = (await hero.locator(":scope > .stack-md > p").boundingBox())!;
    expect(Math.abs(summary.x - title.x), `${width}px: summary aligns with the title`).toBeLessThan(1);
    const buttons = await Promise.all(["책 삭제", "저자/설명 알라딘에서 넣기", "저장"].map(name =>
      page.getByRole("button", { name, exact: true }).boundingBox()));
    for (let index = 0; index < buttons.length; index++) {
      const button = buttons[index]!;
      expect(button.y).toBeGreaterThanOrEqual(input.y + input.height);
      expect(button.x).toBeGreaterThanOrEqual(outer.x - 1);
      expect(button.x + button.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
      if (index) expect(button.x).toBeGreaterThanOrEqual(buttons[index - 1]!.x + buttons[index - 1]!.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await editor.screenshot({ path: testInfo.outputPath(`book-editor-${width}.png`) });
  }
  page.once("dialog", dialog => dialog.accept());
  await openBookEditor(page);
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books(?:\?|$)/);
});
