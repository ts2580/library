import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("book and volume deletion exclude oversized files and invalid unsaved edits", async ({ page }, testInfo) => {
  await login(page);
  const name = `삭제 폼 분리 ${testInfo.project.name}`;
  const created = await page.request.post("/api/books/manual", { multipart: { payload: JSON.stringify({
    book: { name, author: "", description: "", type: "", totalVolume: "", coverUrl: "" }, direct: true, targetBookId: null, selection: []
  }) } });
  expect(created.status()).toBe(201);
  const { bookId } = await created.json();
  await page.goto(`/books/${bookId}`);
  await page.getByRole("button", { name: "직접 추가", exact: true }).click();
  const add = page.getByRole("region", { name: "권 직접 추가", exact: true });
  await add.getByLabel("권 제목", { exact: true }).fill("삭제 검증 권");
  await add.getByRole("button", { name: "권 추가", exact: true }).click();
  const volume = page.locator(".volume-card").filter({ hasText: "삭제 검증 권" });
  await volume.getByRole("button", { name: "상세정보", exact: true }).click();
  const modal = volume.getByRole("dialog");
  const upload = { name: "oversized-fixture.png", mimeType: "image/png", buffer: Buffer.alloc(11 * 1024 * 1024) };
  await modal.getByLabel("표지 파일", { exact: true }).setInputFiles(upload);
  await modal.getByLabel("권 제목", { exact: true }).fill("");
  page.once("dialog", dialog => dialog.dismiss());
  await modal.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(volume).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("volume-delete-form.png"), fullPage: true });
  expect(await modal.getByRole("button", { name: "삭제", exact: true }).evaluate(element =>
    Array.from(new FormData((element as HTMLButtonElement).form!).keys()).filter(key => !key.startsWith("$ACTION_")).sort()
  )).toEqual(["bookId", "volumeId"]);
  page.once("dialog", dialog => dialog.accept());
  await modal.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".volume-card")).toHaveCount(0);
  await page.locator(".book-edit-form").getByLabel("표지 파일", { exact: true }).setInputFiles(upload);
  await page.locator(".book-edit-form").getByLabel("제목", { exact: true }).fill("");
  await page.screenshot({ path: testInfo.outputPath("book-delete-form.png"), fullPage: true });
  expect(await page.getByRole("button", { name: "책 삭제", exact: true }).evaluate(element =>
    Array.from(new FormData((element as HTMLButtonElement).form!).keys()).filter(key => !key.startsWith("$ACTION_")).sort()
  )).toEqual(["bookId"]);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "책 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/books\?/);
  const options = await (await page.request.get(`/api/books/options?query=${encodeURIComponent(name)}`)).json();
  expect(options).toEqual([]);
});
