import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

test("branch stock purchase buttons use product links and retain listing links when product links are missing", async ({ page }, testInfo) => {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  const username = `branch-purchase-${randomUUID()}`;
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1").run(username).lastInsertRowid);
  const book = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES('지점 구매 버튼 검증',?)").run(owner).lastInsertRowid);
  const listing = "https://www.aladin.co.kr/shop/UsedShop/wuseditemall.aspx?ItemId=fixture&OffCode=SEOUL";
  const product = "https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=offer-a";
  const cases = [
    { name: "개별 구매 주소", purchase: product, listing, expected: product },
    { name: "지점 조회 주소만 있음", purchase: null, listing, expected: listing },
    { name: "상대 구매 주소", purchase: "/shop/wproduct.aspx?ItemId=offer-b", listing, expected: "https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=offer-b" },
    { name: "잘못된 개별 주소", purchase: "javascript:alert(1)", listing, expected: listing },
    { name: "구매 주소 없음", purchase: null, listing: null, expected: null }
  ];
  for (const [index, entry] of cases.entries()) {
    const volume = Number(db.prepare("INSERT INTO book_volumes(book,volume,name,isbn13) VALUES(?,?,?,'9780000000193')").run(book, index + 1, entry.name).lastInsertRowid);
    db.prepare("INSERT INTO branchbook(book,book_volume_id,volume,name,branch,branchname,price,booklink,purchaseurl) VALUES(?,?,?,?,'SEOUL','서울점','1700',?,?)")
      .run(book, volume, index + 1, entry.name, entry.listing, entry.purchase);
  }
  try {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    for (const route of ["/inventory", "/inventory/branches/SEOUL"]) {
      await page.goto(route);
      for (const entry of cases) {
        const card = page.locator(".stock-card").filter({ has: page.getByRole("link", { name: entry.name, exact: true }) });
        const purchase = card.getByRole("link", { name: "구매", exact: true });
        if (entry.expected) {
          await expect(purchase, entry.name).toHaveAttribute("href", entry.expected);
          await expect(purchase).toHaveAttribute("target", "_blank");
        } else {
          await expect(purchase).toHaveCount(0);
          await expect(card).toContainText("구매 링크 없음");
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("branch-purchase-links.png"), fullPage: true });
  } finally {
    await page.close();
    db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM member WHERE id=?").run(owner);
    db.close();
  }
});
