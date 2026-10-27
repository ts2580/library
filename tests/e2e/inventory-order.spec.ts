import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

test("store and direct-delivery inventory keep book-name and numeric-volume order across pages", async ({ page }, testInfo) => {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  const username = `inventory-order-${randomUUID()}`;
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1").run(username).lastInsertRowid);
  function addStock(book: number, name: string, number: number) {
    const volume = Number(db.prepare("INSERT INTO book_volumes(book,volume,name,isbn13) VALUES(?,?,?,'9780000000193')").run(book, number, name).lastInsertRowid);
    for (const [branch, branchName] of [["SEOUL", "서울점"], ["ALADIN_DROPSHIPPING", "알라딘 직배송"]]) {
      db.prepare("INSERT INTO branchbook(book,book_volume_id,volume,name,branch,branchname,price) VALUES(?,?,?,?,?,?,'1700')").run(book, volume, number, name, branch, branchName);
    }
  }
  for (let index = 1; index <= 29; index++) {
    const name = `정렬 책 ${String(index).padStart(2, "0")}`;
    const book = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES(?,?)").run(name, owner).lastInsertRowid);
    addStock(book, name, 1);
  }
  const series = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES('가 시리즈',?)").run(owner).lastInsertRowid);
  for (const number of [10, 1, 2]) addStock(series, `가 시리즈 ${number}권`, number);
  const expected = ["가 시리즈 1권", "가 시리즈 2권", "가 시리즈 10권", ...Array.from({ length: 29 }, (_, index) => `정렬 책 ${String(index + 1).padStart(2, "0")}`)];
  try {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/inventory");
    const titles = page.locator(".stock-card .volume-title-link");
    await expect(titles).toHaveText(expected.flatMap(title => [title, title]).slice(0, 24));
    for (const branch of ["SEOUL", "ALADIN_DROPSHIPPING"]) {
      await page.goto(`/inventory/branches/${branch}`);
      await expect(titles).toHaveText(expected.slice(0, 24));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`inventory-${branch}-name-order.png`) });
      await page.getByRole("link", { name: "다음 페이지", exact: true }).click();
      await expect(titles).toHaveText(expected.slice(24));
    }
  } finally {
    await page.close();
    db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM member WHERE id=?").run(owner);
    db.close();
  }
});
