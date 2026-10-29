import type { Page } from "@playwright/test";

export async function openBookEditor(page: Page) {
  const editor = page.getByRole("dialog", { name: "책 정보 수정", exact: true });
  if (!await editor.isVisible()) await page.getByRole("button", { name: "책 정보 수정", exact: true }).click();
  return editor;
}
