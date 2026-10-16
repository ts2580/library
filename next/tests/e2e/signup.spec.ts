import { expect, test } from "@playwright/test";

test("enabled signup stores the introduction and rejects password mismatch and duplicate usernames", async ({ page, browser }, testInfo) => {
  const username = `signup-${testInfo.project.name}`;
  await page.goto("/user/signup");
  await expect(page).toHaveURL(/\/signup/);
  async function fill(passwordConfirmation: string) {
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("이름", { exact: true }).fill("가입 검사");
    await page.getByLabel("이메일", { exact: true }).fill("fixture@example.com");
    await page.getByLabel("소개", { exact: true }).fill("자바에서 사용하던 소개 입력");
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-signup-password");
    await page.getByLabel("비밀번호 확인", { exact: true }).fill(passwordConfirmation);
  }
  await fill("fixture-wrong-password");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(page.locator(".flash-error")).toContainText("일치하지 않습니다");
  await fill("fixture-signup-password");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/profile");
  await expect(page.getByLabel("소개", { exact: true })).toHaveValue("자바에서 사용하던 소개 입력");
  await expect(page.locator(".page-header .status-badge")).toHaveText(testInfo.project.name === "desktop" ? "ADMIN" : "USER");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("signup-profile.png"), fullPage: true });
  const duplicate = await browser.newContext();
  try {
    const other = await duplicate.newPage(); await other.goto("/signup");
    await other.getByLabel("아이디", { exact: true }).fill(username);
    await other.getByLabel("비밀번호", { exact: true }).fill("fixture-signup-password");
    await other.getByLabel("비밀번호 확인", { exact: true }).fill("fixture-signup-password");
    await other.getByRole("button", { name: "계정 만들기" }).click();
    await expect(other.locator(".flash-error")).toContainText("이미 사용 중");
  } finally { await duplicate.close(); }
});
