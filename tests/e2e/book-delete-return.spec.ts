import { openBookEditor } from "./helpers/book-editor";
import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

async function library(page: Page, run: (db: Database.Database, owner: number) => Promise<void>) {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  db.pragma("foreign_keys=ON");
  const username = `delete-return-${randomUUID()}`;
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1").run(username).lastInsertRowid);
  for (let index = 1; index <= 35; index++) {
    const name = `복귀 100%_! ${String(index).padStart(2, "0")}`;
    const book = Number(db.prepare("INSERT INTO books(name,author,type,owner_id) VALUES(?,'복귀 저자','복귀 분류',?)").run(name, owner).lastInsertRowid);
    const volume = Number(db.prepare("INSERT INTO book_volumes(book,volume,name) VALUES(?,1,?)").run(book, name).lastInsertRowid);
    db.prepare("INSERT INTO branchbook(book,book_volume_id,volume,name,branch,branchname,price) VALUES(?,?,1,?,'SEOUL','서울점','1000')").run(book, volume, name);
  }
  try {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await run(db, owner);
  } finally {
    await page.close();
    db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM member WHERE id=?").run(owner);
    db.close();
  }
}

const origins: Array<{ path: string; params: Record<string, string>; selector: string; edit?: boolean }> = [
  { path: "/books", params: { title: "복귀 100%_!", type: "복귀 분류", page: "2" }, selector: ".book-card", edit: true },
  { path: "/books", params: { author: "복귀 저자", type: "복귀 분류", page: "2" }, selector: ".book-card" },
  { path: "/products", params: { ownedQ: "복귀 100%_!", ownedSort: "name", ownedPage: "2", q: "필터 기억", aladinPage: "2" }, selector: ".stock-card .volume-title-link" },
  { path: "/inventory/branches/SEOUL", params: { q: "복귀 100%_!", page: "2" }, selector: ".stock-card .volume-title-link" }
];
for (const [index, origin] of origins.entries()) {
  test(`book deletion returns to filtered origin ${index + 1} with its page and search parameters`, async ({ page }) => {
    await library(page, async () => {
      const source = `${origin.path}?${new URLSearchParams(origin.params)}`;
      await page.goto(source);
      const link = page.locator(origin.selector).first();
      await link.click();
      await expect(page.locator(".book-hero h1")).toBeVisible();
      if (origin.edit) {
        await openBookEditor(page);
        const form = page.getByRole("form", { name: "책 정보", exact: true });
        await form.getByLabel("총 권수", { exact: true }).fill("전체 12권");
        await form.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "책 정보 수정", exact: true })).toBeHidden();
        await openBookEditor(page);
        await expect(form.getByLabel("총 권수", { exact: true })).toHaveValue("전체 12권");
        await expect(page.locator(".flash-success")).toBeVisible();
      }
      await page.reload();
      page.once("dialog", dialog => dialog.accept());
      await openBookEditor(page);
      await page.getByRole("button", { name: "책 삭제", exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(origin.path);
      const actual = new URL(page.url()).searchParams;
      for (const [key, value] of Object.entries(origin.params)) expect(actual.get(key), key).toBe(value);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (origin.path === "/books") {
        await expect(page.getByLabel("검색어", { exact: true })).toHaveValue(origin.params.title ?? origin.params.author!);
        await expect(page.getByLabel("분류", { exact: true })).toHaveValue(origin.params.type!);
      }
    });
  });
}

for (const staleSearch of [false, true]) {
  test(`quick-add deletion restores the current client search from ${staleSearch ? "stale" : "empty"} URL parameters`, async ({ page }) => {
    await library(page, async () => {
      const owned: Record<string, string> = staleSearch ? { ownedQ: "복귀 100%_!", ownedSort: "name", ownedPage: "2" } : {};
      const initial = new URLSearchParams(staleSearch ? { ...owned, q: "이전 검색어", aladinPage: "1" } : {});
      await page.goto(`/products${initial.size ? `?${initial}` : ""}`);
      if (!staleSearch) await page.getByText("알라딘 상품 검색·한 권씩 등록", { exact: true }).click();
      const quickAdd = page.getByRole("region", { name: "알라딘 한 권 추가", exact: true });
      const searchStatus = quickAdd.getByRole("status").filter({ hasText: /^검색 결과/ });
      const query = "빠른 복귀 & 100%_!";
      await quickAdd.getByLabel("알라딘 검색어", { exact: true }).fill(query);
      await quickAdd.getByRole("button", { name: "알라딘 검색", exact: true }).click();
      await expect(searchStatus).toHaveText("검색 결과 40건 · 1페이지");
      await quickAdd.getByRole("navigation", { name: "알라딘 한 권 검색 페이지", exact: true })
        .getByRole("button", { name: "다음 페이지", exact: true }).click();
      await expect(searchStatus).toHaveText("검색 결과 40건 · 2페이지");
      await quickAdd.getByLabel("알라딘 검색어", { exact: true }).fill("아직 검색하지 않은 입력");
      const item = quickAdd.locator(".quick-add-item").first();
      await item.getByRole("button", { name: "이 권 저장", exact: true }).click();
      await item.getByRole("link", { name: "추가한 책 보기", exact: true }).click();
      await expect(page.locator(".book-hero h1")).toHaveText("선택 샘플 2-1");
      await page.reload();
      page.once("dialog", dialog => dialog.accept());
      await openBookEditor(page);
      await page.getByRole("button", { name: "책 삭제", exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/products");
      const restored = new URL(page.url()).searchParams;
      for (const [key, value] of Object.entries({ ...owned, q: query, aladinPage: "2" })) expect(restored.get(key), key).toBe(value);
      await expect(quickAdd.getByLabel("알라딘 검색어", { exact: true })).toHaveValue(query);
      await expect(searchStatus).toHaveText("검색 결과 40건 · 2페이지");
      await expect(quickAdd.getByRole("heading", { level: 3 })).toHaveText(["선택 샘플 2-1", "선택 샘플 2-2"]);
      await expect(item.getByRole("button", { name: "이 권 저장", exact: true })).toBeVisible();
      if (staleSearch) {
        await expect(page.getByLabel("권 제목·ISBN", { exact: true })).toHaveValue(owned.ownedQ!);
        await expect(page.getByLabel("정렬", { exact: true })).toHaveValue(owned.ownedSort!);
      }
    });
  });
}

test("deleting a branch's last book returns to the inventory list with its search parameters", async ({ page }) => {
  await library(page, async (db, owner) => {
    const book = (db.prepare("SELECT id FROM books WHERE owner_id=? ORDER BY id LIMIT 1").get(owner) as {id:number}).id;
    db.prepare("UPDATE branchbook SET branch='ONLY_ONE',branchname='마지막 지점' WHERE book=?").run(book);
    await page.goto(`/inventory/branches/ONLY_ONE?${new URLSearchParams({q:"복귀 100%_!",page:"1"})}`);
    await page.locator(".stock-card .volume-title-link").click();
    page.once("dialog", dialog => dialog.accept());
    await openBookEditor(page);
    await page.getByRole("button", {name:"책 삭제",exact:true}).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/inventory");
    expect(new URL(page.url()).searchParams.get("q")).toBe("복귀 100%_!");
    expect(new URL(page.url()).searchParams.get("page")).toBe("1");
    await expect(page.getByRole("heading",{name:"지점 재고",exact:true})).toBeVisible();
  });
});

test("the delete action rejects a forged external return location", async ({ page }) => {
  await library(page, async () => {
    await page.goto("/books");
    await page.locator(".book-card").first().click();
    await openBookEditor(page);
    const button = page.getByRole("button", {name:"책 삭제",exact:true});
    await button.evaluate(element => {
      const form = (element as HTMLButtonElement).form!;
      const field = document.createElement("input");field.type="hidden";field.name="returnTo";field.value="https://untrusted.example/after-delete";form.append(field);
    });
    page.once("dialog", dialog => dialog.accept());
    await button.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/books");
    expect(new URL(page.url()).origin).toBe("http://127.0.0.1:25648");
  });
});
