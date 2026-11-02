import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { searchPage, productPage } from "../fixtures/aladin-pages.mjs";
import { withRequestGate } from "@/features/aladin/request-gate";

vi.mock("server-only", () => ({}));
const html = vi.hoisted(() => vi.fn());
vi.mock("@/features/aladin/client", () => ({ aladinHtml: html }));
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-aladin-review-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "bookshelf.sqlite");
const { sqlite } = await import("@/db");
const { importAladinSelection } = await import("@/features/aladin/bulk-import");
const { enrichMissingBookInfo } = await import("@/features/books/enrichment");

beforeEach(() => {
  sqlite.exec("DELETE FROM books; DELETE FROM member; INSERT INTO member(id,username,password_hash) VALUES(1,'review','fixture'); INSERT INTO books(id,name,owner_id,author,description) VALUES(1,'기존 책',1,'수동 저자','수동 &lt;설명&gt;');");
  html.mockReset();
});
afterEach(() => vi.useRealTimers());
afterAll(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

it("registers 150 uncached products across pages without expiring queued request locks", async () => {
  vi.useFakeTimers({ loopLimit: 1_000_000 });
  const started = Date.now();
  const products = Array.from({ length: 150 }, (_, index) => ({ itemId: String(1000 + index),
    isbn13: String(9780000000000 + index), title: `권 ${index + 1}`, pubDate: "2026-01", author: "저자" }));
  let details = 0;
  html.mockImplementation((raw: string) => withRequestGate(path.join(directory, "bulk-gate.sqlite"), 1000, async () => {
    const url = new URL(raw);
    if (url.pathname.includes("wsearchresult")) {
      const page = Number(url.searchParams.get("page"));
      return searchPage(products.slice((page - 1) * 50, page * 50), { page, pageSize: 50, total: 150 });
    }
    details++;
    return productPage(products.find(item => item.itemId === url.searchParams.get("ItemId"))!);
  }));
  const pending = importAladinSelection(1, { query: "150권 대량 등록", targetBookId: 1, seriesName: "기존 책", sideStory: false,
    preserveSelectionOrder: true, selection: products.map((item, index) => ({ key: `item:${item.itemId}`, page: Math.floor(index / 50) + 1 })) })
    .then(value => ({ value, error: null }), error => ({ value: null, error }));
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.error).toBeNull();
  expect(result.value).toMatchObject({ count: 150 });
  expect(details).toBe(150);
  expect(Date.now() - started).toBeGreaterThanOrEqual(152_000);
  expect(sqlite.prepare("SELECT name,volume FROM book_volumes ORDER BY id").all()).toEqual(products.map((item, index) => ({ name: item.title, volume: index + 1 })));
}, 30_000);

it.each(["9780590353427", "059035342X"])("hydrates K/U-code ISBN candidates despite a different stored title: %s", async isbn => {
  sqlite.prepare("INSERT INTO book_volumes(id,book,name,isbn,description) VALUES(1,1,'다른 부제로 저장한 권',?,'직접 &amp;설명')").run(isbn);
  const item = { itemId: "208556", isbn13: "9780590353427", title: "원래 제목과 부제", author: "확인된 저자", description: "조회 설명" };
  html.mockImplementation(async (raw: string) => {
    const url = new URL(raw);
    if (url.pathname.includes("wproduct")) return productPage(item);
    return searchPage(url.searchParams.has("SearchWord") ? [{ ...item, isbn13: isbn.length === 10 ? "U123456789" : "K123456789" }] : []);
  });
  expect(await enrichMissingBookInfo(1, 1)).toMatchObject({ booksUpdated: 0, volumesUpdated: 1 });
  expect(sqlite.prepare("SELECT author,description,link FROM book_volumes WHERE id=1").get()).toEqual({
    author: item.author, description: "직접 &amp;설명", link: "https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=208556" });
  expect(sqlite.prepare("SELECT author,description FROM books WHERE id=1").get()).toEqual({ author: "수동 저자", description: "수동 &lt;설명&gt;" });
});

it("stops detail fetching after a failure and leaves the entire selection unsaved", async () => {
  const products = [8100, 8101, 8102].map(id => ({ itemId: String(id), title: `권 ${id}`, isbn13: String(9780000000000 + id) }));
  const fetched: string[] = [];
  html.mockImplementation(async (raw: string) => {
    const url = new URL(raw);
    if (url.pathname.includes("wsearchresult")) return searchPage(products);
    const id = url.searchParams.get("ItemId")!;
    fetched.push(id);
    return id === "8101" ? "<html>점검 중</html>" : productPage(products.find(item => item.itemId === id)!);
  });
  await expect(importAladinSelection(1, { query: "중간 상품 실패", targetBookId: 1, seriesName: "기존 책", sideStory: false,
    preserveSelectionOrder: true, selection: products.map(item => ({ key: `item:${item.itemId}`, page: 1 })) })).rejects.toMatchObject({ code: "ALADIN_FORMAT_CHANGED" });
  expect(fetched).toEqual(["8100", "8101"]);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM book_volumes").get()).toEqual({ count: 0 });
});

it("rejects a K-code candidate whose detailed ISBN belongs to another edition", async () => {
  sqlite.exec("INSERT INTO book_volumes(id,book,name,isbn13) VALUES(1,1,'저장된 제목','9780590353403')");
  const item = { itemId: "208557", isbn13: "9780590353427", title: "저장된 제목", author: "다른 판본 저자", description: "wrong edition" };
  html.mockImplementation(async (raw: string) => new URL(raw).pathname.includes("wproduct")
    ? productPage(item) : searchPage([{ ...item, isbn13: "U123456789" }]));
  expect(await enrichMissingBookInfo(1, 1)).toMatchObject({ volumesUpdated: 0 });
  expect(html.mock.calls.some(([url]) => String(url).includes("wproduct"))).toBe(true);
  expect(sqlite.prepare("SELECT author,description,link FROM book_volumes WHERE id=1").get()).toEqual({ author: null, description: null, link: null });
});
