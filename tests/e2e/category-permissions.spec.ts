import { expect, test, type Page } from "@playwright/test";
import { load } from "cheerio";

async function login(page: Page, username = "fixture-user") {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("regular users cannot delete shared categories even with an administrator's action form", async ({ page, browser }, testInfo) => {
  await login(page, "fixture-admin"); await page.goto("/profile");
  const category = `공용 권한 검증 ${testInfo.project.name}`;
  const panel = page.getByRole("region", { name: "카테고리 관리", exact: true });
  await panel.getByLabel("새 카테고리", { exact: true }).fill(category);
  await panel.getByRole("button", { name: "카테고리 추가", exact: true }).click();
  await expect(page.locator(".flash-success")).toBeVisible();
  const row = panel.locator("li").filter({ has: page.getByText(category, { exact: true }) });
  // Read the progressive-enhancement form before hydration removes the action metadata.
  const $ = load(await (await page.request.get("/profile")).text());
  const form = $("input[name='category']").filter((_, element) => $(element).val() === category).closest("form");
  const fields = form.find("input[name]").toArray().map(element => [$(element).attr("name")!, String($(element).val() ?? "")] as [string, string]);
  expect(fields.some(([key]) => key.startsWith("$ACTION_"))).toBe(true);
  const origin = new URL(page.url()).origin;
  const context = await browser.newContext({ baseURL: origin });
  try {
    const regular = await context.newPage(); await login(regular); await regular.goto("/profile");
    await expect(regular.getByRole("region", { name: "카테고리 관리", exact: true }).getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
    // Browser FormData preserves empty action-marker fields that APIRequestContext omits.
    const response = await regular.evaluate(async entries => {
      const body = new FormData(); for (const [key, value] of entries) body.append(key, value);
      const result = await fetch("/profile", { method: "POST", body });
      return { status: result.status, url: result.url };
    }, fields);
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.url)).toContain("관리자");
    await page.reload(); await expect(row).toHaveCount(1);
    page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: "삭제", exact: true }).click();
    await expect(row).toHaveCount(0);
  } finally { await context.close(); }
});
