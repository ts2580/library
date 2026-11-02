import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { searchPage, productPage } from "../fixtures/aladin-pages.mjs";
import { withRequestGate } from "@/features/aladin/request-gate";

vi.mock("server-only", () => ({}));
const html = vi.hoisted(() => vi.fn());
vi.mock("@/features/aladin/client", () => ({ aladinHtml: html }));
vi.mock("@/features/aladin/covers", () => ({ persistAladinCover: async () => null }));
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-aladin-review-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "bookshelf.sqlite");
const { sqlite } = await import("@/db");
const { importAladinSelection } = await import("@/features/aladin/bulk-import");
const { getAladinProduct, searchAladinBooks, hydrateAladinItem } = await import("@/features/aladin/service");
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

const captured = (name: string) => readFileSync(new URL(`../fixtures/aladin-html/${name}.html`, import.meta.url), "utf8");
const isbn10Selection = { query: "059035342X", targetBookId: 1, seriesName: "기존 책", sideStory: false,
  selection: [{ key: "item:208556", page: 1 }] };
async function useCapturedIsbn10() {
  html.mockImplementation(async (raw: string) => captured(raw.includes("/shop/wproduct") ? "product" : "isbn10"));
  await getAladinProduct("208556", { fresh: true });
}
it("rejects duplicate registration of an ISBN10-only volume without a product link", async () => {
  await useCapturedIsbn10();
  sqlite.exec("INSERT INTO book_volumes(id,book,volume,name,isbn) VALUES(1,1,1,'기존 권','059035342X')");
  await expect(importAladinSelection(1, isbn10Selection)).rejects.toThrow("이미 등록");
  expect(sqlite.prepare("SELECT isbn,isbn13,link FROM book_volumes").all()).toEqual([{isbn:"059035342X",isbn13:null,link:null}]);
});
it("retains both equivalent ISBNs when registering a new volume from captured HTML", async () => {
  await useCapturedIsbn10();
  await expect(importAladinSelection(1, isbn10Selection)).resolves.toMatchObject({count:1});
  expect(sqlite.prepare("SELECT isbn,isbn13 FROM book_volumes").all()).toEqual([{isbn:"059035342X",isbn13:"9780590353427"}]);
});
it("rejects an ISBN10-only preview when detail belongs to another edition", async () => {
  await useCapturedIsbn10();
  const search=await searchAladinBooks({query:"059035342X"});
  await expect(hydrateAladinItem({...search.items[0]!,isbn13:null,isbn:"0590353403"})).rejects.toMatchObject({code:"ALADIN_ISBN_MISMATCH"});
});

it.each(['9780590353427','K123456789','U123456789'])('rejects a legacy ISBN10 duplicate when preview exposes %s', async code => {
  await useCapturedIsbn10();
  const product={itemId:'208556',isbn13:code,title:'다른 부제로 검색한 권'};
  html.mockImplementation(async(raw:string)=>raw.includes('/shop/wproduct')?captured('product'):searchPage([product]));
  sqlite.exec("INSERT INTO book_volumes(id,book,volume,name,isbn) VALUES(1,1,1,'기존 권','059035342X')");
  await expect(importAladinSelection(1,isbn10Selection)).rejects.toThrow('이미 등록');
  expect(sqlite.prepare('SELECT COUNT(*) n FROM book_volumes').get()).toEqual({n:1});
});
it('rejects two selected product IDs that hydrate to the same ISBN without saving any volume',async()=>{
  const products=[{itemId:'820001',isbn13:'K123456789',title:'동일 ISBN 상품 1'},{itemId:'820002',isbn13:'9780590353427',title:'동일 ISBN 상품 2'}];
  html.mockImplementation(async(raw:string)=>{
    const url=new URL(raw);
    if(url.pathname.includes('wsearchresult'))return searchPage(products);
    return productPage({...products.find(item=>item.itemId===url.searchParams.get('ItemId'))!,isbn13:'9780590353427'});
  });
  await expect(importAladinSelection(1,{...isbn10Selection,selection:products.map(item=>({key:`item:${item.itemId}`,page:1}))})).rejects.toThrow('ISBN');
  expect(sqlite.prepare('SELECT COUNT(*) n FROM book_volumes').get()).toEqual({n:0});
});

it('recognizes an owned ISBN13 preview from a formatted legacy ISBN10', async()=>{
  await useCapturedIsbn10();
  sqlite.exec("INSERT INTO book_volumes(id,book,volume,name,isbn) VALUES(1,1,1,'기존 권','0-590-35342-X')");
  const {withOwnership}=await import('@/features/aladin/ownership');
  const result=await searchAladinBooks({query:'059035342X'},{fresh:true});
  expect(withOwnership(1,{...result,items:result.items.map(item=>({...item,isbn:null}))}).items[0]?.owned).toBe(true);
});
it('keeps canonical duplicate checks scoped to the importing owner',async()=>{
  await useCapturedIsbn10();
  sqlite.exec("INSERT INTO member(id,username,password_hash) VALUES(2,'other','fixture'); INSERT INTO books(id,name,owner_id) VALUES(2,'다른 계정',2); INSERT INTO book_volumes(book,volume,name,isbn) VALUES(2,1,'다른 계정 권','059035342X')");
  await expect(importAladinSelection(1,isbn10Selection)).resolves.toMatchObject({count:1});
  expect(sqlite.prepare('SELECT COUNT(*) n FROM book_volumes').get()).toEqual({n:2});
});
it('does not collapse unrelated ISBN-free products into one null identifier',async()=>{
  const products=[{itemId:'820011',title:'ISBN 없는 상품 1'},{itemId:'820012',title:'ISBN 없는 상품 2'}];
  html.mockImplementation(async(raw:string)=>{
    const url=new URL(raw);
    return url.pathname.includes('wsearchresult')?searchPage(products):productPage(products.find(item=>item.itemId===url.searchParams.get('ItemId'))!);
  });
  await expect(importAladinSelection(1,{...isbn10Selection,selection:products.map(item=>({key:`item:${item.itemId}`,page:1}))})).resolves.toMatchObject({count:2});
  expect(sqlite.prepare('SELECT COUNT(*) n FROM book_volumes').get()).toEqual({n:2});
});
