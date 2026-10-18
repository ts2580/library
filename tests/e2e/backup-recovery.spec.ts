import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

test("an already-running worker expires abandoned assembly and ends browser polling", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill("fixture-admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const response = await page.request.post("/api/backup/covers/uploads", { data: { filename: "interrupted.zip", totalSize: 10, totalChunks: 1 } });
  expect(response.status()).toBe(201);
  const { uploadId } = await response.json();
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  try {
    db.prepare("UPDATE backup_upload_job SET status='ASSEMBLING',lock_token='interrupted-web',updated_at=CURRENT_TIMESTAMP WHERE upload_id=?").run(uploadId);
    writeFileSync(path.join(directory, "uploads", uploadId, "partial.tmp"), "partial");
    await page.evaluate(id => sessionStorage.setItem("bookshelf.cover-restore-job", id), uploadId);
    await page.goto("/profile");
    await expect(page.getByText("ZIP 조립", { exact: true })).toBeVisible();
    db.prepare("UPDATE backup_upload_job SET updated_at=datetime('now','-16 minutes') WHERE upload_id=?").run(uploadId);
    await expect(page.getByText("작업 실패", { exact: true })).toBeVisible({ timeout: 40_000 });
    expect(existsSync(path.join(directory, "uploads", uploadId))).toBe(false);
    expect(await page.evaluate(() => sessionStorage.getItem("bookshelf.cover-restore-job"))).toBeNull();
    await expect(page.getByText("작업 상태 다시 확인", { exact: true })).toHaveCount(0);
  } finally {
    db.prepare("DELETE FROM backup_upload_job WHERE upload_id=?").run(uploadId); db.close();
  }
});
