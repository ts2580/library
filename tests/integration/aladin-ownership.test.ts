import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSearchPage } from "@/features/aladin/html";
import { searchPage } from "../fixtures/aladin-pages.mjs";

vi.mock("server-only", () => ({}));
const hydrate = vi.hoisted(() => vi.fn());
vi.mock("@/features/aladin/service", () => ({ hydrateAladinItem: hydrate }));
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-ownership-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "bookshelf.sqlite");
const { sqlite } = await import("@/db");
const { withOwnership } = await import("@/features/aladin/ownership");

function preview(code = "K123456789") {
  return parseSearchPage(searchPage([{ itemId: "208556", title: "검색한 책", isbn13: code }]), 1);
}

beforeEach(() => {
  sqlite.exec(`DELETE FROM books; DELETE FROM member;
    INSERT INTO member(id,username,password_hash) VALUES(1,'owner','fixture'),(2,'other','fixture');
    INSERT INTO books(id,name,owner_id) VALUES(1,'기존 책',1),(2,'다른 책',1),(3,'타인 책',2);`);
  hydrate.mockReset().mockImplementation(async item => ({ ...item, isbn13: "9780590353427", isbn: null }));
});
afterAll(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

it.each([
  "http://www.aladin.co.kr/shop/wproduct.aspx?ItemId=208556&partner=openAPI&start=api",
  "https://aladin.co.kr/shop/wproduct.aspx?partner=legacy&itemid=208556#detail"
])("recognizes K-code results by product identity despite legacy link formatting: %s", async link => {
  sqlite.prepare("INSERT INTO book_volumes(book,name,isbn13,link) VALUES(2,'다른 제목','9780590353427',?)").run(link);
  expect((await withOwnership(1, preview())).items[0]?.owned).toBe(true);
  expect(hydrate).not.toHaveBeenCalled();
});

it.each(["059035342X", "0-590-35342-x", "978-0-590-35342-7"])("resolves ISBN-less K-code previews against an ISBN-only owned volume: %s", async isbn => {
  sqlite.prepare("INSERT INTO book_volumes(book,name,isbn) VALUES(1,'직접 저장한 제목',?)").run(isbn);
  expect((await withOwnership(1, preview())).items[0]?.owned).toBe(true);
  expect(hydrate).toHaveBeenCalledTimes(1);
});

it("matches canonical ISBNs already present in a preview without requesting details", async () => {
  sqlite.exec("INSERT INTO book_volumes(book,name,isbn) VALUES(1,'ISBN10만 저장','0-590-35342-x')");
  expect((await withOwnership(1, preview("9780590353427"))).items[0]?.owned).toBe(true);
  expect(hydrate).not.toHaveBeenCalled();
});

it("keeps another owner's copies selectable and never matches a title alone", async () => {
  sqlite.exec(`INSERT INTO book_volumes(book,name,isbn13,link) VALUES
    (1,'검색한 책','9780590353403','https://example.com/shop/wproduct.aspx?ItemId=208556'),
    (3,'타인 소장','9780590353427','https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=208556');`);
  expect((await withOwnership(1, preview())).items[0]?.owned).toBe(false);
  expect((await withOwnership(2, preview())).items[0]?.owned).toBe(true);
});

it("skips detail lookup when the owner has no stored ISBNs to compare", async () => {
  expect((await withOwnership(1, preview())).items[0]?.owned).toBe(false);
  expect(hydrate).not.toHaveBeenCalled();
});

it("does not return an unverified selectable result when required detail lookup fails", async () => {
  sqlite.exec("INSERT INTO book_volumes(book,name,isbn13) VALUES(1,'기존 권','9780590353427')");
  hydrate.mockRejectedValue(new Error("상세 조회 실패"));
  await expect(withOwnership(1, preview())).rejects.toThrow("상세 조회 실패");
});
