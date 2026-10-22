import { expect, test } from "@playwright/test";

for (const longText of [false, true]) {
test(`manual preview keeps ${longText ? "long" : "regular"} result text inside its cards on FHD, QHD and mobile screens`, async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/books");
  await page.getByRole("button", { name: "책 직접 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "책 직접 추가", exact: true });
  if (longText) await page.route("**/api/aladin/search?**", async route => {
    const response = await route.fetch();
    const result = await response.json();
    result.items = result.items.map((item: Record<string, unknown>) => ({
      ...item,
      title: `${item.title} ${"LongUnbrokenBookTitle".repeat(4)}`,
      author: "LongUnbrokenAuthorName".repeat(3),
      description: "긴설명과공백없는텍스트도카드안에표시되어야합니다".repeat(5)
    }));
    await route.fulfill({ response, json: result });
  });
  await dialog.getByLabel("제목", { exact: true }).fill("화면 너비 검증");
  await dialog.getByRole("button", { name: "추가 예정 확인", exact: true }).click();
  const results = dialog.locator(".search-results");
  const cards = results.locator(".search-result-card");
  await expect(cards).toHaveCount(2);

  const widths = testInfo.project.name === "desktop" ? [1920, 2300, 2560, 3440] : [768, 412, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1440 });
    expect(await results.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(width >= 1920 ? 2 : 1);
    await results.screenshot({ path: testInfo.outputPath(`manual-preview-${width}.png`) });
    const overflow = await cards.evaluateAll(elements => elements.flatMap((card, index) => {
      const outer = card.getBoundingClientRect();
      const content = card.querySelector(".stack-sm")!;
      const problems: string[] = [];
      if (card.scrollWidth > card.clientWidth + 1) problems.push(`card ${index} overflows`);
      for (const child of content.children) {
        const rect = child.getBoundingClientRect();
        if (rect.left < outer.left || rect.right > outer.right + 1) problems.push(`card ${index} child escapes`);
        // Range bounds catch text painting outside a correctly sized grid item.
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const text of range.getClientRects()) {
          if (text.left < outer.left || text.right > outer.right + 1) problems.push(`card ${index} text escapes`);
        }
      }
      return problems;
    }));
    expect(overflow, `${width}px result contents must fit inside their own cards`).toEqual([]);
    expect(await results.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }

  await dialog.getByRole("button", { name: "현재 페이지 모두 제외", exact: true }).click();
  await cards.first().getByRole("checkbox", { name: /^선택 / }).check();
  await expect(dialog.getByRole("status").filter({ hasText: "1권 선택" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "1권 추가", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "현재 페이지 모두 제외", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "0권 추가", exact: true })).toBeDisabled();
});
}
