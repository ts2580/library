import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/aladin/client", () => ({
  aladinJson: api, aladinHtml: vi.fn(), isAladinConfigured: () => true,
  AladinRateLimitError: class extends Error {}
}));
const remoteCover = vi.hoisted(() => vi.fn());
vi.mock("@/features/covers/service", async (original) => {
  const actual = await original<typeof import("@/features/covers/service")>();
  return { ...actual, persistCover: (input: Parameters<typeof actual.persistCover>[0]) =>
    input.remoteUrl && !input.file ? remoteCover(input) : actual.persistCover(input) };
});
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-parity-"));
process.env.BOOKSHELF_DB_PATH = path.join(directory, "bookshelf.sqlite");
process.env.BOOKSHELF_DATA_DIR = directory;
const { sqlite } = await import("@/db");
const { updateVolume, addVolume, deleteVolumes } = await import("@/features/books/service");
const { enrichMissingBookInfo } = await import("@/features/books/enrichment");
const { getDashboardData } = await import("@/features/dashboard/queries");
const { searchOwnedVolumes } = await import("@/features/books/queries");
const { withOwnership } = await import("@/features/aladin/ownership");
const { importExcelBackup, exportExcelBackup } = await import("@/features/backup/excel");
const { regeneratePendingCovers } = await import("@/features/covers/regeneration");
const { lookupUsedStocks } = await import("@/features/aladin/service");
const { importAladinSelection } = await import("@/features/aladin/bulk-import");
const { importAladinItem } = await import("@/features/aladin/import");
const { getBookDetail } = await import("@/features/books/queries");
const { processNextStockRefreshJob, requestStockRefresh } = await import("@/features/inventory/service");

beforeEach(() => {
  sqlite.exec("DELETE FROM branchbook; DELETE FROM book_volumes; DELETE FROM books; DELETE FROM member;");
  sqlite.exec("INSERT INTO member(id,username,password_hash) VALUES(1,'audit','test'),(2,'foreign','test'); INSERT INTO books(id,name,owner_id,cover_generated) VALUES(1,'시리즈',1,1),(2,'다른 계정',2,1);");
  sqlite.exec("UPDATE stock_refresh_job SET status='IDLE', requested_by=NULL, running=0");
  api.mockReset().mockResolvedValue({ item: [] });
  remoteCover.mockReset().mockImplementation(async () => {
    mkdirSync(path.join(directory, "covers/1"), { recursive: true });
    writeFileSync(path.join(directory, "covers/1/rebuilt.webp"), "fixture");
    return "cover://1/rebuilt.webp";
  });
});
afterAll(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });
const payload = { name: "수정한 권", seq: "2", isbn13: "", author: "", price: "", description: "", link: "", pubDate: "", coverUrl: "" };
function volume(id = 1, book = 1, seq: number | null = 1) {
  sqlite.prepare("INSERT INTO book_volumes(id,book,volume,name,cover_generated) VALUES(?,?,?,'권 제목',1)").run(id, book, seq);
}
async function workbookFile(workbook: ExcelJS.Workbook) {
  return new File([new Uint8Array(await workbook.xlsx.writeBuffer())], "backup.xlsx");
}

describe("Java feature parity regressions", () => {
  it.each([
    ["&lt;책&gt; &amp; &quot;설명&quot; &#39;인용&#39; &#x1F4DA; &nbsp;", '<책> & "설명" \'인용\' 📚 \u00a0'],
    ["<책> <img src=x onerror=alert(1)> &unknown;", "<책> <img src=x onerror=alert(1)> &unknown;"],
    ["&amp;lt;책&amp;gt;", "&lt;책&gt;"],
    [null, null]
  ])("decodes stored book and volume descriptions once as plain text: %s", (stored, displayed) => {
    volume();
    sqlite.prepare("UPDATE books SET description=? WHERE id=1").run(stored);
    sqlite.prepare("UPDATE book_volumes SET description=? WHERE id=1").run(stored);
    for (let read = 0; read < 2; read++) {
      const detail = getBookDetail(1, 1)!;
      expect(detail.description).toBe(displayed);
      expect(detail.volumes[0]?.description).toBe(displayed);
    }
    expect(sqlite.prepare("SELECT description FROM books WHERE id=1").get()).toEqual({ description: stored });
  });
  it.each(["완결 12권", null])("preserves the total-volume memo %s across manual and Aladin changes", async (memo) => {
    sqlite.prepare("UPDATE books SET totalvolume=? WHERE id=1").run(memo);
    const manualId = await addVolume(1, 1, payload);
    expect(getBookDetail(1, 1)).toMatchObject({ totalVolume: memo, volumeCount: 1 });
    deleteVolumes(1, 1, [manualId]);
    expect(getBookDetail(1, 1)).toMatchObject({ totalVolume: memo, volumeCount: 0 });
    await importAladinItem(1, { targetBookId: 1, title: "개별 등록", author: "", description: "", isbn13: "9780000000111", cover: "", price: "", link: "", pubDate: "", categoryName: "" });
    expect(getBookDetail(1, 1)).toMatchObject({ totalVolume: memo, volumeCount: 1 });
    api.mockResolvedValue({ startIndex: 1, itemsPerPage: 20, totalResults: 1, item: [{ title: "선택 등록", isbn13: "9780000000222" }] });
    await importAladinSelection(1, { query: "검색", seriesName: "기존 시리즈", targetBookId: 1, sideStory: false, selection: [{ page: 1, key: "9780000000222" }] });
    expect(getBookDetail(1, 1)).toMatchObject({ totalVolume: memo, volumeCount: 2 });
    const backup = await exportExcelBackup(1, "audit");
    await importExcelBackup(1, new File([new Uint8Array(backup)], "memo.xlsx"));
    expect(getBookDetail(1, 1)).toMatchObject({ totalVolume: memo, volumeCount: 2 });
  });
  it("preserves independent seq and volume values including nulls through Excel export and repeated restore", async () => {
    const expected = [{ seq: 99, volume: 3 }, { seq: 7, volume: null }, { seq: null, volume: 4 }, { seq: null, volume: null }, { seq: 0, volume: 0 }];
    expected.forEach((row, index) => sqlite.prepare("INSERT INTO book_volumes(book,name,seq,volume) VALUES(1,?,?,?)").run(`권 ${index}`, row.seq, row.volume));
    const file = new File([new Uint8Array(await exportExcelBackup(1, "audit"))], "numbers.xlsx");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer());
    expect(workbook.getWorksheet("Volumes")!.getRow(1).values).toEqual(expect.arrayContaining(["seq", "volume"]));
    sqlite.exec("DELETE FROM book_volumes; DELETE FROM books WHERE owner_id=1");
    await importExcelBackup(1, file);
    await importExcelBackup(1, file);
    expect(sqlite.prepare("SELECT seq,volume FROM book_volumes ORDER BY id").all()).toEqual(expected);
  });
  it.each(["seq", "volume"])("continues to restore old Excel backups with only a %s column", async (column) => {
    const workbook = new ExcelJS.Workbook();
    const books = workbook.addWorksheet("Books"); books.addRow(["source_id", "name"]); books.addRow(["A", "기존 형식"]);
    const volumes = workbook.addWorksheet("Volumes"); volumes.addRow(["book_source_id", "name", column]); volumes.addRow(["A", "3권", 3]); volumes.addRow(["A", "외전", null]);
    await importExcelBackup(1, await workbookFile(workbook));
    expect(sqlite.prepare("SELECT seq,volume FROM book_volumes ORDER BY id").all()).toEqual([{ seq: 3, volume: 3 }, { seq: null, volume: null }]);
  });
  it("restores single-item numbering, category and total-volume notes with server-resolved metadata", async () => {
    api.mockResolvedValue({ startIndex: 1, itemsPerPage: 20, totalResults: 1, item: [{ title: "서버 권 제목", isbn13: "9780000000101", isbn: "123456789X", author: "서버 저자" }] });
    const result = await importAladinSelection(1, { query: "검색", seriesName: "새 시리즈", targetBookId: null, sideStory: false, startVolume: 7, category: "직접 분류", totalVolume: "완결 12권", selection: [{ page: 1, key: "9780000000101" }] });
    expect(sqlite.prepare("SELECT name,type,totalvolume FROM books WHERE id=?").get(result.bookId)).toEqual({ name: "새 시리즈", type: "직접 분류", totalvolume: "완결 12권" });
    expect(sqlite.prepare("SELECT volume,name,author FROM book_volumes WHERE book=?").get(result.bookId)).toEqual({ volume: 7, name: "서버 권 제목", author: "서버 저자" });
    await expect(importAladinSelection(1, { query: "검색", seriesName: "타인 도서", targetBookId: 2, sideStory: true, selection: [{ page: 1, key: "9780000000101" }] })).rejects.toThrow();
  });
  it("recognizes an existing ISBN10 even when the search result now also includes ISBN13", async () => {
    volume(); sqlite.exec("UPDATE book_volumes SET isbn='123456789X'");
    const item = { title: "같은 권", isbn13: "9780000000101", isbn: "123456789X", cover: null, author: null, description: null, priceSales: null, link: null, pubDate: null, categoryName: null };
    expect(withOwnership(1, { page: 1, pageSize: 20, totalResults: 1, items: [item] }).items[0]?.owned).toBe(true);
    api.mockResolvedValue({ totalResults: 1, item: [item] });
    await expect(importAladinSelection(1, { query: "검색", seriesName: "중복", targetBookId: null, sideStory: false, selection: [{ page: 1, key: item.isbn13 }] })).rejects.toThrow("이미 등록");
  });
  it("applies the category edited from a volume to its parent book and keeps owner isolation", async () => {
    volume(); await updateVolume(1, 1, 1, { ...payload, type: "변경한 분류" });
    expect(sqlite.prepare("SELECT type FROM books WHERE id=1").get()).toEqual({ type: "변경한 분류" });
    expect(sqlite.prepare("SELECT type FROM books WHERE id=2").get()).toEqual({ type: null });
    expect(getDashboardData(1).categories).toMatchObject([{ category: "변경한 분류", volumeCount: 1 }]);
  });
  it("includes purchased, planned and excluded volumes in category total amounts", () => {
    volume(); volume(2, 1, 2); volume(3, 1, 3); volume(4, 2, 1);
    sqlite.exec("UPDATE book_volumes SET price='1,000',ispurchased=1 WHERE id=1; UPDATE book_volumes SET price='2,000' WHERE id=2; UPDATE book_volumes SET price='3,000',noneedtobuy=1 WHERE id=3; UPDATE book_volumes SET price='99999' WHERE id=4");
    expect(getDashboardData(1).categories).toEqual([{ category: "미분류", volumeCount: 3, purchasedAmount: 1000, plannedAmount: 2000, totalAmount: 6000 }]);
  });
  it("searches ISBN10 and sorts imported volumes by registration date", () => {
    volume(); volume(2, 1, 2);
    sqlite.exec("UPDATE book_volumes SET isbn='123456789X',createddate='2026-10-01' WHERE id=1; UPDATE book_volumes SET createddate='2020-01-01' WHERE id=2");
    expect(searchOwnedVolumes(1, { query: "123456789X" }).items.map((item) => item.id)).toEqual([1]);
    expect(searchOwnedVolumes(1, { sort: "recent" }).items.map((item) => item.id)).toEqual([1, 2]);
  });
  it("selects dropshipping or offstore inventory and returns the matching raw response", async () => {
    api.mockImplementation(async (endpoint) => endpoint === "ItemLookUp.aspx"
      ? { item: [{ title: "중고 책", subInfo: { usedList: { aladinUsed: { itemCount: 1, minPrice: 2000 }, spaceUsed: { itemCount: 1, minPrice: 1000 } } } }] }
      : { itemOffStoreList: [{ offCode: "SEOUL", offName: "서울점" }] });
    const direct = await lookupUsedStocks("123456789X", "dropshipping");
    expect(direct.stocks.map((stock) => stock.branch)).toEqual(["ALADIN_DROPSHIPPING"]);
    expect(api).toHaveBeenCalledTimes(1);
    const store = await lookupUsedStocks("123456789X", "offstore");
    expect(store.stocks.map((stock) => stock.branch)).toEqual(["SEOUL"]);
    expect(store.raw).toHaveProperty("itemOffStoreList");
    api.mockImplementation(async (endpoint) => endpoint === "ItemLookUp.aspx" ? { item: [] } : { itemOffStoreList: [] });
    expect(await lookupUsedStocks("123456789X", "offstore")).toMatchObject({ successful: true, stocks: [], raw: { itemOffStoreList: [] } });
  });
  it("preserves multiple identically named books and volumes through repeated Excel restores", async () => {
    const workbook = new ExcelJS.Workbook();
    const books = workbook.addWorksheet("Books"); books.addRow(["source_id", "name"]); books.addRow(["A", "같은 책"]); books.addRow(["B", "같은 책"]);
    const volumes = workbook.addWorksheet("Volumes"); volumes.addRow(["source_id", "book_source_id", "name", "volume"]);
    volumes.addRow(["1", "A", "같은 권", 1]); volumes.addRow(["2", "A", "같은 권", 1]); volumes.addRow(["3", "B", "같은 권", 1]);
    const file = await workbookFile(workbook);
    await importExcelBackup(1, file);
    expect(await importExcelBackup(1, file)).toMatchObject({ booksCreated: 0, booksUpdated: 2, volumesCreated: 0, volumesUpdated: 3 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM book_volumes").get()).toEqual({ n: 3 });
  });
  it("rolls back Excel imports that ambiguously merge separate ISBN series", async () => {
    volume(); sqlite.exec("INSERT INTO books(id,name,owner_id) VALUES(3,'다른 시리즈',1)"); volume(2, 3, 1);
    sqlite.exec("UPDATE book_volumes SET isbn13='9780000000001' WHERE id=1; UPDATE book_volumes SET isbn13='9780000000002' WHERE id=2");
    const workbook = new ExcelJS.Workbook();
    const books = workbook.addWorksheet("Books"); books.addRow(["source_id", "name"]); books.addRow(["A", "합쳐진 책"]);
    const volumes = workbook.addWorksheet("Volumes"); volumes.addRow(["book_source_id", "name", "isbn13"]);
    volumes.addRow(["A", "권 하나", "9780000000001"]); volumes.addRow(["A", "권 둘", "9780000000002"]);
    await expect(importExcelBackup(1, await workbookFile(workbook))).rejects.toThrow("여러 기존 도서");
    expect(sqlite.prepare("SELECT name FROM books WHERE owner_id=1 ORDER BY id").all()).toEqual([{ name: "시리즈" }, { name: "다른 시리즈" }]);
  });
  it("uses the same advanced Aladin filters when revalidating a selected page", async () => {
    api.mockResolvedValue({ startIndex: 2, itemsPerPage: 10, totalResults: 30, item: [{ title: "필터 도서", isbn13: "9780000000001" }] });
    const result = await importAladinSelection(1, { query: "작가", seriesName: "작가 검색 결과", targetBookId: null, sideStory: false,
      searchOptions: { queryType: "Author", searchTarget: "Foreign", sort: "SalesPoint", cover: "None", maxResults: 10, recentPublishFilter: 3, categoryId: 123, outOfStockFilter: true },
      selection: [{ page: 2, key: "9780000000001" }] });
    expect(result.count).toBe(1);
    expect(api).toHaveBeenCalledWith("ItemSearch.aspx", expect.objectContaining({ Query: "작가", QueryType: "Author", SearchTarget: "Foreign", Sort: "SalesPoint", Cover: "None", MaxResults: 10, start: 2, RecentPublishFilter: 3, CategoryId: 123, outofStockfilter: true }));
  });
  it("deletes only selected owned volumes and rejects a mixed-owner batch atomically", () => {
    volume(1); volume(2, 1, 2); volume(3, 2, 1);
    sqlite.exec("INSERT INTO branchbook(id,book,book_volume_id,volume,branch) VALUES(1,1,1,1,'SEOUL'),(2,1,2,2,'SEOUL'),(3,2,3,1,'SEOUL')");
    expect(() => deleteVolumes(1, 1, [1, 3])).toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM book_volumes").get()).toEqual({ n: 3 });
    expect(deleteVolumes(1, 1, [1, 2])).toBe(2);
    expect(sqlite.prepare("SELECT id FROM book_volumes").all()).toEqual([{ id: 3 }]);
    expect(sqlite.prepare("SELECT id FROM branchbook").all()).toEqual([{ id: 3 }]);
  });
  it.each([1, null])("removes ambiguous legacy stock only after every matching volume is selected: %s", (number) => {
    volume(1, 1, number); volume(2, 1, number); volume(3, 1, number); volume(4, 2, number);
    sqlite.prepare("INSERT INTO branchbook(id,book,volume,branch) VALUES(1,1,?,'SEOUL'),(2,2,?,'SEOUL')").run(number, number);
    deleteVolumes(1, 1, [1]);
    expect(sqlite.prepare("SELECT id FROM branchbook ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    deleteVolumes(1, 1, [2, 3]);
    expect(sqlite.prepare("SELECT id FROM branchbook ORDER BY id").all()).toEqual([{ id: 2 }]);
  });
  it.each(["isbn13", "isbn10"])("rejects cross-book %s collisions inside a workbook before inserting data", async (column) => {
    const workbook = new ExcelJS.Workbook();
    const books = workbook.addWorksheet("Books"); books.addRow(["source_id", "name"]); books.addRow(["A", "새 책 A"]); books.addRow(["B", "새 책 B"]);
    const volumes = workbook.addWorksheet("Volumes"); volumes.addRow(["book_source_id", "name", column]);
    volumes.addRow(["A", "첫 권", "9780000000001"]); volumes.addRow(["B", "다른 책의 권", "9780000000001"]);
    const file = await workbookFile(workbook);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(importExcelBackup(1, file)).rejects.toThrow("여러 도서");
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM books").get()).toEqual({ n: 2 });
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM book_volumes").get()).toEqual({ n: 0 });
    }
  });
  it("keeps valid ISBN workbook imports repeatable", async () => {
    const workbook = new ExcelJS.Workbook();
    const books = workbook.addWorksheet("Books"); books.addRow(["source_id", "name"]); books.addRow(["A", "ISBN 책 A"]); books.addRow(["B", "ISBN 책 B"]);
    const volumes = workbook.addWorksheet("Volumes"); volumes.addRow(["book_source_id", "name", "isbn13"]);
    volumes.addRow(["A", "첫 권", "9780000000001"]); volumes.addRow(["B", "다른 권", "9780000000002"]);
    const file = await workbookFile(workbook);
    await importExcelBackup(1, file);
    expect(await importExcelBackup(1, file)).toMatchObject({ booksCreated: 0, booksUpdated: 2, volumesCreated: 0, volumesUpdated: 2 });
  });
  it("enriches missing metadata without overwriting an existing author or purchase state", async () => {
    volume(); sqlite.exec("UPDATE books SET author='직접 입력 저자' WHERE id=1; UPDATE book_volumes SET ispurchased=1,originalUrl='https://example.com/cover.jpg'");
    const description = "조회한 &lt;설명&gt; &amp; &#34;인용&#34;";
    api.mockResolvedValue({ totalResults: 1, item: [{ title: "권 제목", author: "알라딘 저자", description }] });
    expect(await enrichMissingBookInfo(1, 1)).toMatchObject({ booksUpdated: 1, volumesUpdated: 1 });
    expect(sqlite.prepare("SELECT author,description FROM books WHERE id=1").get()).toEqual({ author: "직접 입력 저자", description });
    expect(sqlite.prepare("SELECT author,description,ispurchased,originalUrl FROM book_volumes").get()).toEqual({ author: "알라딘 저자", description, ispurchased: 1, originalUrl: "https://example.com/cover.jpg" });
    expect(getBookDetail(1, 1)?.description).toBe('조회한 <설명> & "인용"');
    expect(getBookDetail(1, 1)?.volumes[0]?.description).toBe('조회한 <설명> & "인용"');
    api.mockClear(); await expect(enrichMissingBookInfo(1, 2)).rejects.toThrow(); expect(api).not.toHaveBeenCalled();
  });
  it("imports the real Java Korean sheets, keys, ISBN10, side stories, and metadata", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("안내").addRow(["형식", "bookshelf-excel-backup"]);
    const books = book.addWorksheet("도서");
    books.addRow(["도서키", "제목", "저자", "분류", "총권수", "설명", "표지", "등록일"]);
    books.addRow(["B7", "이전 도서", "저자", "소설", "완결 10권", "설명", "", "2020-01-01"]);
    const volumes = book.addWorksheet("권");
    volumes.addRow(["도서키", "권키", "권번호", "외전", "ISBN13", "ISBN10", "제목", "저자", "분류", "가격", "구매완료", "구매불필요", "설명", "표지", "원본URL", "상품링크", "출간일", "등록일"]);
    volumes.addRow(["B7", "V1", 3, "아니오", "9780000000001", "123456789X", "정규 권", "저자", "소설", "1,000", "예", "아니오", "내용", "", "https://example.com/cover.jpg", "https://example.com/book", "2020-01-01", "2020-01-02"]);
    volumes.addRow(["B7", "V2", "", "예", "", "1234567881", "외전", "", "", "", "아니오", "예"]);
    const result = await importExcelBackup(1, await workbookFile(book));
    expect(result).toMatchObject({ booksCreated: 1, volumesCreated: 2 });
    expect(sqlite.prepare("SELECT type,totalvolume FROM books WHERE name='이전 도서'").get()).toEqual({ type: "소설", totalvolume: "완결 10권" });
    expect(sqlite.prepare("SELECT volume,isbn,ispurchased,originalUrl,link FROM book_volumes WHERE name='정규 권'").get()).toEqual({ volume: 3, isbn: "123456789X", ispurchased: 1, originalUrl: "https://example.com/cover.jpg", link: "https://example.com/book" });
    expect(sqlite.prepare("SELECT volume,noneedtobuy FROM book_volumes WHERE name='외전'").get()).toEqual({ volume: null, noneedtobuy: 1 });
  });
  it("rejects unrelated workbooks instead of reporting a successful empty import", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("random").addRow(["test"]); book.addWorksheet("other").addRow(["test"]);
    await expect(importExcelBackup(1, await workbookFile(book))).rejects.toThrow();
  });
  it("merges a renamed Excel book by ISBN and retains its stock without creating an empty duplicate", async () => {
    volume(); sqlite.exec("UPDATE book_volumes SET isbn13='9780000000001'; INSERT INTO branchbook(id,book,volume,branch) VALUES(1,1,1,'SEOUL')");
    const workbook = new ExcelJS.Workbook();
    const books = workbook.addWorksheet("Books");
    books.addRow(["source_id", "name"]); books.addRow(["B1", "새 이름"]);
    const volumes = workbook.addWorksheet("Volumes");
    volumes.addRow(["book_source_id", "name", "volume", "isbn13"]); volumes.addRow(["B1", "권 제목", 3, "9780000000001"]);
    await importExcelBackup(1, await workbookFile(workbook));
    const moved = sqlite.prepare("SELECT book,volume FROM book_volumes WHERE id=1").get() as { book: number; volume: number };
    expect(moved.book).toBe(1);
    expect(sqlite.prepare("SELECT id,name FROM books WHERE owner_id=1").all()).toEqual([{ id: 1, name: "새 이름" }]);
    expect(sqlite.prepare("SELECT book,volume,book_volume_id FROM branchbook").get()).toEqual({ ...moved, book_volume_id: 1 });
  });
  it("preserves the original cover URL when only purchase status is edited", async () => {
    volume(); sqlite.exec("UPDATE book_volumes SET originalUrl='https://example.com/original.jpg'");
    await updateVolume(1, 1, 1, { ...payload, isPurchased: "on" });
    expect(sqlite.prepare("SELECT originalUrl,ispurchased FROM book_volumes").get()).toEqual({ originalUrl: "https://example.com/original.jpg", ispurchased: 1 });
  });
  it("does not reassign ambiguous legacy stocks when one duplicate volume number changes", async () => {
    volume(); volume(2);
    sqlite.exec("INSERT INTO branchbook(id,book,volume,branch) VALUES(1,1,1,'SEOUL')");
    await updateVolume(1, 1, 1, payload);
    expect(sqlite.prepare("SELECT volume,book_volume_id FROM branchbook").get()).toEqual({ volume: 1, book_volume_id: null });
  });
  it.each([null, 0, 1])("invalidates uniquely resolved legacy stock for previous volume %s on ISBN change", async number => {
    volume(1, 1, number);
    sqlite.exec("UPDATE book_volumes SET isbn13='9780000000001'");
    sqlite.prepare("INSERT INTO branchbook(id,book,volume,branch) VALUES(1,1,?,'SEOUL')").run(number);
    await updateVolume(1, 1, 1, { ...payload, isbn13: "9780000000002" });
    expect(sqlite.prepare("SELECT * FROM branchbook").all()).toEqual([]);
  });
  it("renumbers a unique NULL legacy stock without conflating a zero volume", async () => {
    volume(1, 1, null); volume(2, 1, 0);
    sqlite.exec("INSERT INTO branchbook(id,book,volume,branch) VALUES(1,1,NULL,'SEOUL'),(2,1,0,'SEOUL')");
    await updateVolume(1, 1, 1, payload);
    expect(sqlite.prepare("SELECT volume,book_volume_id FROM branchbook ORDER BY id").all()).toEqual([
      { volume: 2, book_volume_id: 1 }, { volume: 0, book_volume_id: null }
    ]);
  });
  it("does not guess the link of ambiguous NULL legacy stock", async () => {
    volume(1, 1, null); volume(2, 1, null);
    sqlite.exec("INSERT INTO branchbook(id,book,volume,branch) VALUES(1,1,NULL,'SEOUL')");
    await updateVolume(1, 1, 1, payload);
    expect(sqlite.prepare("SELECT volume,book_volume_id FROM branchbook").get()).toEqual({ volume: null, book_volume_id: null });
  });
  it("restores missing generated covers using the retained original URL before Aladin", async () => {
    volume(); volume(2, 2);
    sqlite.exec("UPDATE book_volumes SET cover='cover://1/missing.webp', originalUrl='https://example.com/original.jpg' WHERE id=1");
    const result = await regeneratePendingCovers(1);
    expect(result).toMatchObject({ pendingVolumes: 1, generatedVolumes: 1 });
    expect(remoteCover).toHaveBeenCalledWith(expect.objectContaining({ remoteUrl: "https://example.com/original.jpg" }));
    expect(api).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT cover FROM book_volumes WHERE id=2").get()).toEqual({ cover: null });
  });
  it("uses the first uploaded volume cover for a book without a cover", async () => {
    await addVolume(1, 1, { ...payload, coverUrl: "https://example.com/cover.jpg" });
    expect(sqlite.prepare("SELECT cover,cover_generated FROM books WHERE id=1").get()).toEqual({ cover: "cover://1/rebuilt.webp", cover_generated: 1 });
  });
  it("retains ISBN10 and legacy cover references through an XLSX round trip", async () => {
    volume(); sqlite.exec("UPDATE book_volumes SET isbn='123456789X',cover='/covers/legacy.jpg'");
    const output = await exportExcelBackup(1, "audit");
    await importExcelBackup(1, new File([new Uint8Array(output)], "roundtrip.xlsx"));
    expect(sqlite.prepare("SELECT isbn,cover FROM book_volumes").get()).toEqual({ isbn: "123456789X", cover: "/covers/legacy.jpg" });
  });
  it("accepts ISBN10 ending in X and requests the matching Aladin identifier type", async () => {
    expect((await lookupUsedStocks("123456789X")).successful).toBe(true);
    expect(api).toHaveBeenCalledWith("ItemLookUp.aspx", expect.objectContaining({ ItemId: "123456789X", itemIdType: "ISBN" }));
  });
  it("rejects 11 and 12 digit identifiers", async () => {
    await expect(lookupUsedStocks("12345678901")).rejects.toThrow();
    await expect(lookupUsedStocks("123456789012")).rejects.toThrow();
  });
  it("keeps Aladin registration available when a remote cover fails", async () => {
    api.mockResolvedValue({ startIndex: 1, itemsPerPage: 20, totalResults: 1, item: [{ title: "등록할 권", isbn13: "9780000000001", cover: "https://example.com/broken.jpg", categoryName: "국내도서>만화>판타지" }] });
    remoteCover.mockRejectedValue(new Error("image download failed"));
    const result = await importAladinSelection(1, { query: "등록할 권", seriesName: "새 시리즈", targetBookId: null, sideStory: false, selection: [{ page: 1, key: "9780000000001" }] });
    expect(result.count).toBe(1);
    expect(sqlite.prepare("SELECT originalUrl,cover_generated FROM book_volumes WHERE book=?").get(result.bookId)).toEqual({ originalUrl: "https://example.com/broken.jpg", cover_generated: 0 });
    expect(sqlite.prepare("SELECT type FROM books WHERE id=?").get(result.bookId)).toEqual({ type: "판타지" });
  });
  it("does not save stale stock when a volume is purchased during the lookup", async () => {
    volume(); sqlite.exec("UPDATE book_volumes SET isbn13='9780000000001'");
    api.mockImplementation(async () => {
      sqlite.exec("UPDATE book_volumes SET ispurchased=1 WHERE id=1");
      return { item: [{ title: "재고", subInfo: { usedList: { aladinUsed: { itemCount: 1, minPrice: 1000 } } } }] };
    });
    requestStockRefresh(1); await processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM branchbook").get()).toEqual({ n: 0 });
  });
});
