import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

test("profile enriches all owned books and volumes through the worker and resumes status after reload", async ({ page }, testInfo) => {
  expect((await page.request.post("/api/books/enrich")).status()).toBe(401);
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  const username = `metadata-${randomUUID()}`;
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'USER' FROM member WHERE id=1").run(username).lastInsertRowid);
  const ids: number[] = [];
  for (let index = 0; index < 5; index++) {
    const bookId = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES(?,?)").run(`이전한 책 ${index}`, owner).lastInsertRowid);
    ids.push(bookId);
    db.prepare("INSERT INTO book_volumes(book,volume,name,description) VALUES(?,1,'선택 샘플 1-1','직접 입력 설명')").run(bookId);
  }
  const foreign = db.prepare("SELECT author,description FROM books WHERE id=2").get();
  try {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    expect((await page.request.post("/api/books/enrich", { headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
    await page.goto("/profile");
    const panel = page.getByRole("region", { name: "전체 책 정보 보강", exact: true });
    await panel.getByRole("button", { name: "전체 책 저자·설명 채우기", exact: true }).click();
    await expect(panel.getByRole("button")).toBeDisabled();
    await page.reload();
    await expect.poll(() => db.prepare("SELECT status FROM metadata_enrichment_job WHERE owner_id=?").get(owner), { timeout: 30000 }).toEqual({ status: "COMPLETED" });
    await expect(panel).toContainText("확인 5/5책");
    await expect(panel).toContainText("책 보강 5");
    await expect(panel).toContainText("권 보강 5");
    expect(db.prepare("SELECT COUNT(*) n FROM books WHERE owner_id=? AND author='테스트 저자'").get(owner)).toEqual({ n: 5 });
    expect(db.prepare("SELECT DISTINCT description FROM book_volumes WHERE book IN (SELECT id FROM books WHERE owner_id=?)").all(owner)).toEqual([{ description: "직접 입력 설명" }]);
    expect(db.prepare("SELECT author,description FROM books WHERE id=2").get()).toEqual(foreign);
    await page.screenshot({ path: testInfo.outputPath("metadata-enrichment-completed.png"), fullPage: true });
    await panel.getByRole("button", { name: "전체 책 저자·설명 채우기", exact: true }).click();
    await expect(page.locator(".toast-message").last()).toHaveText("채울 저자·설명이 없습니다.");
  } finally {
    await page.close();
    db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM member WHERE id=?").run(owner);
    db.close();
  }
});
