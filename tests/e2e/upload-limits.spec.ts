import { expect, test } from "@playwright/test";

test("authenticated multipart endpoints reject oversized bodies before importing", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const manual = await page.request.post("/api/books/manual", { multipart: {
    payload: JSON.stringify({ book: { name: "과대 업로드는 생성되지 않음" }, direct: true }),
    coverFile: { name: "large.webp", mimeType: "image/webp", buffer: Buffer.alloc(8 * 1024 * 1024 + 65536) }
  } });
  expect(manual.status()).toBe(413);
  expect((await manual.json()).message).toContain("허용 크기");
  const excel = await page.request.post("/api/backup/excel/import", { maxRedirects: 0, multipart: {
    backupFile: { name: "large.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.alloc(32 * 1024 * 1024 + 65536) }
  } });
  expect(excel.status()).toBe(303);
  expect(new URL(excel.headers().location).searchParams.get("error")).toContain("허용 크기");
});
