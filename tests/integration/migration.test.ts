import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";

vi.mock("server-only", () => ({}));
vi.mock("@/features/aladin/service", () => ({ lookupUsedStocks: vi.fn(), searchAladinBooks: vi.fn() }));
const configured = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/features/aladin/client", async (original) => ({ ...await original<object>(), isAladinConfigured: configured }));
const cookieDelete = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "expired-test-session" }), delete: cookieDelete }),
  headers: async () => new Headers()
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-integration-"));
process.env.BOOKSHELF_DB_PATH = path.join(directory, "bookshelf.sqlite");
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_LEGACY_OWNER_USERNAME = "fixture-admin";
process.env.REGISTRATION = "false";
const { sqlite } = await import("@/db");
const { bootstrapDatabase } = await import("@/db/bootstrap");
const { getBookList, getBookDetail, getOwnedBookOptions, searchOwnedVolumes, getManualBookCategories } = await import("@/features/books/queries");
const { addVolume, updateVolume } = await import("@/features/books/service");
const { searchInventory } = await import("@/features/inventory/queries");
const jobs = await import("@/features/inventory/service");
const { lookupUsedStocks, searchAladinBooks } = await import("@/features/aladin/service");
const { AladinRateLimitError } = await import("@/features/aladin/client");
const { importAladinSelection } = await import("@/features/aladin/bulk-import");
const { createManualBook } = await import("@/features/books/manual-create");
const { addCategory, removeCategory } = await import("@/features/books/categories");
const { withOwnership } = await import("@/features/aladin/ownership");
const { exportExcelBackup, importExcelBackup } = await import("@/features/backup/excel");
const { getCurrentUser } = await import("@/features/auth/session");
const { signupAction } = await import("@/features/auth/actions");
const { hashPassword, verifyPassword } = await import("@/features/auth/password");
const legacySchema = readFileSync(new URL("../fixtures/legacy-schema.sql", import.meta.url), "utf8");
const databaseExistedAfterImport = existsSync(path.join(directory, "bookshelf.sqlite"));

beforeEach(() => {
  sqlite.exec("DELETE FROM app_sessions; DELETE FROM backup_upload_job; DELETE FROM branchbook; DELETE FROM branch_inventory_summary; DELETE FROM book_volumes; DELETE FROM books; DELETE FROM member;");
  sqlite.prepare("INSERT INTO member(id, username, password_hash, role) VALUES (1, 'fixture-admin', 'test-hash', 'ADMIN'), (2, 'fixture-user', 'test-hash', 'USER')").run();
  sqlite.prepare("INSERT INTO books(id, name, owner_id) VALUES (1, ?, 1), (2, 'other-owner', 2)").run("가나 100%_!\\");
  sqlite.prepare("UPDATE stock_refresh_job SET status = 'IDLE', running = 0, failed = 0, completed = 0, requested_by = NULL, lock_token = NULL, mode='REPLACE_ALL',scope_book_id=NULL").run();
  configured.mockReturnValue(true);
  vi.mocked(lookupUsedStocks).mockReset();
  vi.mocked(searchAladinBooks).mockReset();
  cookieDelete.mockClear();
});

afterAll(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

function volume(id: number, book = 1, number: number | null = 1) {
  sqlite.prepare("INSERT INTO book_volumes(id, book, seq, volume, isbn13, name) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, book, 900 + id, number, `978000000${String(id).padStart(4, "0")}`, `권 ${id}`);
}
function stock(id: number, book = 1, volumeId: number | null = null, number = 1) {
  sqlite.prepare("INSERT INTO branchbook(id, book, book_volume_id, volume, branch, branchname, name, price) VALUES (?, ?, ?, ?, 'SEOUL', ?, ?, '1,000')")
    .run(id, book, volumeId, number, id % 2 ? "서울점" : "서울", "재고 100%_! 가나");
}
function item(key: string) {
  return { title: `권 ${key}`, isbn13: key, isbn: null, author: null, description: null, cover: null, priceSales: null, link: null, pubDate: null, categoryName: null };
}

describe("legacy SQLite adoption", () => {
  it("adds trimmed categories once and deletes unused categories", () => {
    const name = "프로필 추가 삭제 검증";
    addCategory(` ${name} `); addCategory(name);
    expect(sqlite.prepare("SELECT COUNT(*) count FROM book_categories WHERE name=?").get(name)).toEqual({ count: 1 });
    removeCategory(name);
    expect(getManualBookCategories()).not.toContain(name);
  });
  it("rejects invalid category names and preserves categories used by any owner", () => {
    expect(() => addCategory("   ")).toThrow("1~120");
    expect(() => removeCategory("x".repeat(121))).toThrow("1~120");
    const name = "다른 소유자 사용 분류";
    addCategory(name);
    sqlite.prepare("UPDATE books SET type=? WHERE id=2").run(name);
    expect(() => removeCategory(name)).toThrow("사용 중");
    expect(getManualBookCategories()).toContain(name);
    expect(sqlite.prepare("SELECT type FROM books WHERE id=2").get()).toEqual({ type: name });
  });
  it("offers saved categories even when no current book uses them", () => {
    sqlite.prepare("INSERT OR IGNORE INTO book_categories(name) VALUES (?)").run("저장만 한 카테고리");
    expect(getManualBookCategories()).toContain("저장만 한 카테고리");
  });
  it("preserves a trimmed category still used by a legacy book with surrounding spaces", () => {
    const name = "이전 공백 분류";
    sqlite.prepare("UPDATE books SET type=? WHERE id=2").run(` ${name} `);
    addCategory(name);
    expect(() => removeCategory(name)).toThrow("사용 중");
    expect(getManualBookCategories()).toContain(name);
    expect(sqlite.prepare("SELECT type FROM books WHERE id=2").get()).toEqual({ type: ` ${name} ` });
    sqlite.prepare("UPDATE books SET type=NULL WHERE id=2").run();
    removeCategory(name);
    expect(getManualBookCategories()).not.toContain(name);
  });
  it("does not open or migrate the database just by importing server modules", () => {
    expect(databaseExistedAfterImport).toBe(false);
  });
  it("preserves rows and links only exact, unique canonical volume matches", () => {
    const legacy = new BetterSqlite3(":memory:");
    try {
      legacy.exec(legacySchema);
      legacy.exec("INSERT INTO member(id,username,password_hash) VALUES (1,'fixture-admin','test'); INSERT INTO books(id,name,owner_id) VALUES(1,'series',1); INSERT INTO book_volumes(id,book,seq,volume) VALUES(1,1,99,2),(2,1,1,3),(3,1,2,3); INSERT INTO branchbook(id,book,volume) VALUES(1,1,2),(2,1,2.5),(3,1,3);");
      bootstrapDatabase(legacy);
      expect(legacy.prepare("SELECT id,book_volume_id FROM branchbook ORDER BY id").all()).toEqual([
        { id: 1, book_volume_id: 1 }, { id: 2, book_volume_id: null }, { id: 3, book_volume_id: null }
      ]);
      expect(legacy.pragma("foreign_key_check")).toEqual([]);
      legacy.prepare("UPDATE member SET role='USER' WHERE id=1").run();
      bootstrapDatabase(legacy);
      expect(legacy.prepare("SELECT role FROM member WHERE id=1").get()).toEqual({ role: "USER" });
      expect(legacy.prepare("SELECT COUNT(*) AS count FROM bookshelf_migrations").get()).toEqual({ count: 3 });
    } finally { legacy.close(); }
  });
  it("fails atomically when an ownerless database has no explicitly selected owner", () => {
    const legacy = new BetterSqlite3(":memory:");
    try {
      legacy.exec(legacySchema);
      legacy.exec("INSERT INTO member(id,username,password_hash) VALUES(1,'someone-else','test'); INSERT INTO books(id,name) VALUES(1,'unassigned');");
      expect(() => bootstrapDatabase(legacy)).toThrow("Ownerless books");
      expect(legacy.prepare("SELECT owner_id FROM books").get()).toEqual({ owner_id: null });
      expect(legacy.pragma("table_info(member)")).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "role" })]));
    } finally { legacy.close(); }
  });
  it.each([1, 2])("upgrades an existing version-%s database without changing roles, inventory, or legacy links", version => {
    const prior = new BetterSqlite3(":memory:");
    try {
      bootstrapDatabase(prior);
      if (version === 1) prior.exec("ALTER TABLE stock_refresh_job DROP COLUMN scope_book_id; ALTER TABLE stock_refresh_job DROP COLUMN mode;");
      prior.exec("ALTER TABLE stock_refresh_job DROP COLUMN run_id;");
      prior.prepare("DELETE FROM bookshelf_migrations WHERE version>?").run(version);
      prior.exec("INSERT INTO member(id,username,password_hash,role) VALUES(1,'fixture-admin','test','USER'); INSERT INTO books(id,name,owner_id) VALUES(1,'keep',1); INSERT INTO book_volumes(id,book,volume) VALUES(1,1,1); INSERT INTO branchbook(id,book,volume,price) VALUES(1,1,1,'900');");
      const before = prior.prepare("SELECT * FROM branchbook").all();
      bootstrapDatabase(prior); bootstrapDatabase(prior);
      expect(prior.prepare("SELECT * FROM branchbook").all()).toEqual(before);
      expect(prior.prepare("SELECT role FROM member WHERE id=1").get()).toEqual({ role: "USER" });
      expect(prior.prepare("SELECT mode,scope_book_id FROM stock_refresh_job").get()).toEqual({ mode: "REPLACE_ALL", scope_book_id: null });
      expect(prior.prepare("SELECT run_id FROM stock_refresh_job").get()).toEqual({ run_id: null });
      expect(prior.prepare("SELECT version FROM bookshelf_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    } finally { prior.close(); }
  });
});

describe("owned queries and changes", () => {
  it.each(["%", "_", "!", "\\", "가나".normalize("NFD")])("searches literal and Unicode input %s", (search) => {
    expect(getBookList(1, { search }).items.map((book) => book.id)).toEqual([1]);
    expect(getOwnedBookOptions(1, search).map((book) => book.id)).toEqual([1]);
  });
  it("hides foreign books and rejects writes to another owner's book", async () => {
    expect(getBookDetail(1, 2)).toBeNull();
    await expect(addVolume(1, 2, { name: "new", seq: "1", isbn13: "", author: "", price: "", description: "", link: "", pubDate: "", coverUrl: "" })).rejects.toThrow();
  });
  it("uses volume rather than legacy seq and updates unambiguous stock links", async () => {
    volume(1); stock(1);
    expect(getBookDetail(1, 1)?.volumes[0]?.seq).toBe(1);
    await updateVolume(1, 1, 1, { name: "edited", seq: "2", isbn13: "9780000000001", author: "", price: "", description: "", link: "", pubDate: "", coverUrl: "" });
    expect(sqlite.prepare("SELECT volume, book_volume_id FROM branchbook WHERE id=1").get()).toEqual({ volume: 2, book_volume_id: 1 });
  });
  it("paginates inventory and matches literal search without revealing another owner", () => {
    volume(1); volume(2, 2);
    for (let id = 1; id <= 26; id++) stock(id, 1, 1);
    stock(27, 2, 2);
    const first = searchInventory(1, { query: "%_!", page: 1 });
    expect(first.total).toBe(26); expect(first.items).toHaveLength(24);
    expect(searchInventory(1, { query: "가나".normalize("NFD"), page: 2 }).items).toHaveLength(2);
    expect(first.items.every((row) => row.bookId === 1)).toBe(true);
  });
  it("searches cached stock titles even when the current volume title differs", () => {
    volume(1); stock(1, 1, 1);
    sqlite.prepare("UPDATE books SET name='series' WHERE id=1").run();
    expect(searchInventory(1, { query: "100%_!" }).total).toBe(1);
  });
  it("searches owned volumes by ISBN while preserving canonical volume numbers", () => {
    volume(1); volume(2, 2);
    expect(searchOwnedVolumes(1, { query: "9780000000001" }).items).toEqual([
      expect.objectContaining({ bookId: 1, seq: 1, isbn13: "9780000000001" })
    ]);
    expect(searchOwnedVolumes(1, { query: "9780000000002" }).items).toEqual([]);
  });
});

describe("stock job lifecycle", () => {
  it("does not clear inventory for missing configuration or duplicate requests", () => {
    volume(1); stock(1, 1, 1);
    configured.mockReturnValue(false); expect(() => jobs.requestStockRefresh(1)).toThrow();
    configured.mockReturnValue(true); expect(jobs.requestStockRefresh(1).started).toBe(true);
    expect(jobs.requestStockRefresh(1).started).toBe(false);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM branchbook").get()).toEqual({ n: 1 });
  });
  it("rechecks configuration after queueing and preserves existing inventory", async () => {
    volume(1); stock(1, 1, 1); jobs.requestStockRefresh(1); configured.mockReturnValue(false);
    await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM branchbook").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT status FROM stock_refresh_job").get()).toEqual({ status: "FAILED" });
  });
  it("clears a zero-target owner's stale stock while retaining other owners", async () => {
    volume(1); volume(2, 2); stock(1, 1, 1); stock(2, 2, 2);
    sqlite.prepare("UPDATE book_volumes SET ispurchased=1 WHERE book=1").run();
    jobs.requestStockRefresh(1); await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT book FROM branchbook").all()).toEqual([{ book: 2 }]);
    expect(sqlite.prepare("SELECT status FROM stock_refresh_job").get()).toEqual({ status: "COMPLETED" });
    expect(lookupUsedStocks).not.toHaveBeenCalled();
  });
  it("counts a rate-limited target and rebuilds summaries after failure", async () => {
    volume(1); volume(2); jobs.requestStockRefresh(1);
    vi.mocked(lookupUsedStocks).mockResolvedValueOnce({ successful: true, raw: {}, stocks: [
      { branch: "SEOUL", branchName: "서울", grade: "상", price: "1,000", title: "test", bookLink: null, purchaseLink: null },
      { branch: "SEOUL", branchName: "서울점", grade: "중", price: "2,000", title: "test", bookLink: null, purchaseLink: null }
    ] }).mockRejectedValueOnce(new AladinRateLimitError());
    await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT status,processed,success,fail FROM stock_refresh_job").get()).toEqual({ status: "FAILED", processed: 2, success: 1, fail: 1 });
    expect(sqlite.prepare("SELECT stock_count,total_amount FROM branch_inventory_summary").get()).toEqual({ stock_count: 2, total_amount: 3000 });
  });
  it("marks an interrupted job failed and restores summary data", () => {
    volume(1); stock(1, 1, 1); sqlite.prepare("UPDATE stock_refresh_job SET status='RUNNING',running=1").run();
    jobs.recoverInterruptedStockJob();
    expect(sqlite.prepare("SELECT status,running FROM stock_refresh_job").get()).toEqual({ status: "FAILED", running: 0 });
    expect(sqlite.prepare("SELECT stock_count FROM branch_inventory_summary").get()).toEqual({ stock_count: 1 });
  });
});

describe("book-scoped additive stock search", () => {
  const offer = { branch: "SEOUL", branchName: "서울", grade: "상", title: "new", price: "9,000",
    bookLink: "https://www.aladin.co.kr/list", purchaseLink: "https://www.aladin.co.kr/offer/a" };
  it("rejects foreign books before queueing or external calls", () => {
    expect(() => jobs.requestBookStockSearch(1, 2)).toThrow("책");
    expect(() => jobs.requestBookStockSearch(1, 999)).toThrow("책");
    expect(sqlite.prepare("SELECT status FROM stock_refresh_job").get()).toEqual({ status: "IDLE" });
    expect(lookupUsedStocks).not.toHaveBeenCalled();
  });
  it("searches only eligible volumes of the selected book and preserves every old row including matching legacy offers", async () => {
    sqlite.prepare("INSERT INTO books(id,name,owner_id) VALUES(3,'same owner other book',1)").run();
    volume(1); volume(2, 1, 2); volume(3, 1, 3); volume(4, 3); volume(5, 2);
    sqlite.prepare("UPDATE book_volumes SET ispurchased=1 WHERE id=2").run();
    sqlite.prepare("UPDATE book_volumes SET noneedtobuy=1 WHERE id=3").run();
    stock(1, 1, null); stock(2, 1, 2, 2); stock(3, 3, 4); stock(4, 2, 5);
    sqlite.prepare("UPDATE branchbook SET grade=?,booklink=?,purchaseurl=? WHERE id=1").run(offer.grade, offer.bookLink, offer.purchaseLink);
    const before = sqlite.prepare("SELECT * FROM branchbook ORDER BY id").all();
    vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: true, raw: {}, stocks: [offer, { ...offer, price: "2,000", purchaseLink: "https://www.aladin.co.kr/offer/b" }] });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(jobs.requestBookStockSearch(1, 1).started).toBe(true);
      expect(jobs.requestStockRefresh(1).started).toBe(false);
      await jobs.processNextStockRefreshJob();
      expect(sqlite.prepare("SELECT * FROM branchbook WHERE id<=4 ORDER BY id").all()).toEqual(before);
      expect(sqlite.prepare("SELECT book,book_volume_id,price FROM branchbook WHERE id>4").all()).toEqual([{ book: 1, book_volume_id: 1, price: "2,000" }]);
      expect(sqlite.prepare("SELECT status,mode,scope_book_id,total,processed FROM stock_refresh_job").get())
        .toEqual({ status: "COMPLETED", mode: "APPEND_BOOK", scope_book_id: 1, total: 1, processed: 1 });
    }
    expect(vi.mocked(lookupUsedStocks).mock.calls.map(([isbn]) => isbn)).toEqual(["9780000000001", "9780000000001"]);
    expect(sqlite.prepare("SELECT stock_count FROM branch_inventory_summary").get()).toEqual({ stock_count: 5 });
  });
  it.each(["empty", "failed", "partial", "network"])("preserves saved inventory when lookup is %s", async mode => {
    volume(1); volume(2, 2); stock(1, 1, 1); stock(2, 2, 2);
    const before = sqlite.prepare("SELECT * FROM branchbook ORDER BY id").all();
    if (mode === "network") vi.mocked(lookupUsedStocks).mockRejectedValue(new TypeError("network"));
    else if (mode === "failed") vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: false, stocks: [], errorMessage: "upstream failed" });
    else vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: true, raw: {}, stocks: mode === "empty" ? [] : [offer], partial: mode === "partial" });
    jobs.requestBookStockSearch(1, 1); await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT * FROM branchbook ORDER BY id").all()).toEqual(before);
    expect(sqlite.prepare("SELECT success,empty,fail FROM stock_refresh_job").get()).toEqual({ success: 0, empty: mode === "empty" ? 1 : 0, fail: mode === "empty" ? 0 : 1 });
  });
  it("preserves inventory when there are no eligible volumes", async () => {
    volume(1); stock(1, 1, 1);
    sqlite.prepare("UPDATE book_volumes SET ispurchased=1 WHERE id=1").run();
    const before = sqlite.prepare("SELECT * FROM branchbook").all();
    jobs.requestBookStockSearch(1, 1); await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT * FROM branchbook").all()).toEqual(before);
    expect(lookupUsedStocks).not.toHaveBeenCalled();
  });
  it.each(["deleted", "transferred", "unconfigured"])("never falls back to a global refresh after the queued book is %s", async change => {
    volume(1); volume(2, 2); stock(1, 1, 1); stock(2, 2, 2);
    jobs.requestBookStockSearch(1, 1);
    if (change === "deleted") sqlite.prepare("DELETE FROM books WHERE id=1").run();
    else if (change === "transferred") sqlite.prepare("UPDATE books SET owner_id=2 WHERE id=1").run();
    else configured.mockReturnValue(false);
    const before = sqlite.prepare("SELECT * FROM branchbook ORDER BY id").all();
    await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT * FROM branchbook ORDER BY id").all()).toEqual(before);
    expect(sqlite.prepare("SELECT status FROM stock_refresh_job").get()).toEqual({ status: "FAILED" });
    expect(lookupUsedStocks).not.toHaveBeenCalled();
  });
  it("keeps old and newly appended inventory when a later volume hits the rate limit", async () => {
    volume(1); volume(2); volume(3, 2); stock(1, 1, 1); stock(2, 2, 3);
    const before = sqlite.prepare("SELECT * FROM branchbook ORDER BY id").all();
    vi.mocked(lookupUsedStocks).mockResolvedValueOnce({ successful: true, raw: {}, stocks: [offer] }).mockRejectedValueOnce(new AladinRateLimitError());
    jobs.requestBookStockSearch(1, 1); await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT * FROM branchbook WHERE id<=2 ORDER BY id").all()).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM branchbook").get()).toEqual({ n: 3 });
    expect(sqlite.prepare("SELECT status,processed,success,fail FROM stock_refresh_job").get()).toEqual({ status: "FAILED", processed: 2, success: 1, fail: 1 });
  });
});

describe("Aladin multi-page selection", () => {
  const request = { query: "series", targetBookId: 1, seriesName: "series", sideStory: false,
    selection: [{ page: 1, key: "9780000000001" }, { page: 2, key: "9780000000003" }, { page: 2, key: "9780000000002" }] };
  it("refetches pages and preserves stable search order when publication dates are missing", async () => {
    vi.mocked(searchAladinBooks).mockImplementation(async (input: unknown) => {
      const { page } = input as { page: number };
      return { page, pageSize: 20, totalResults: 40,
        items: page === 2 ? [item("9780000000002"), item("9780000000003")] : [item("9780000000001")] };
    });
    const result = await importAladinSelection(1, request);
    expect(result.count).toBe(3);
    expect(sqlite.prepare("SELECT isbn13,volume FROM book_volumes ORDER BY id").all()).toEqual([
      { isbn13: "9780000000002", volume: 1 }, { isbn13: "9780000000003", volume: 2 }, { isbn13: "9780000000001", volume: 3 }
    ]);
  });
  it.each([false, true])("numbers by publication date across pages when manual=%s", async (manual) => {
    vi.mocked(searchAladinBooks).mockImplementation(async (input: unknown) => {
      const { page } = input as { page: number };
      return { page, pageSize: 20, totalResults: 40, items: page === 2 ? [
        { ...item("9780000000002"), pubDate: "2026-07-31" },
        { ...item("9780000000003"), pubDate: "2026-03-20" }
      ] : [{ ...item("9780000000001"), pubDate: "2026-05-29" }] };
    });
    if (manual) await createManualBook(1, { book: { name: "series", author: "", description: "", type: "", totalVolume: "", coverUrl: "" }, direct: false, targetBookId: 1, selection: request.selection });
    else await importAladinSelection(1, request);
    expect(sqlite.prepare("SELECT isbn13,volume FROM book_volumes WHERE book=1 ORDER BY volume").all()).toEqual([
      { isbn13: "9780000000003", volume: 1 }, { isbn13: "9780000000001", volume: 2 }, { isbn13: "9780000000002", volume: 3 }
    ]);
  });
  it("starts at four after three regular volumes and ignores side stories", async () => {
    volume(1, 1, 1); volume(2, 1, 2); volume(3, 1, 3); volume(4, 1, null);
    expect(getOwnedBookOptions(1)[0]?.nextVolume).toBe(4);
    vi.mocked(searchAladinBooks).mockResolvedValue({ page: 1, pageSize: 20, totalResults: 2, items: [
      { ...item("9781111111112"), pubDate: "2026-07-31" }, { ...item("9781111111111"), pubDate: "2026-03-20" }
    ] });
    await importAladinSelection(1, { ...request, selection: [{ page: 1, key: "9781111111112" }, { page: 1, key: "9781111111111" }] });
    expect(sqlite.prepare("SELECT isbn13,volume FROM book_volumes WHERE isbn13 LIKE '978111%' ORDER BY volume").all()).toEqual([
      { isbn13: "9781111111111", volume: 4 }, { isbn13: "9781111111112", volume: 5 }
    ]);
  });
  it("rejects a missing selection before creating any rows", async () => {
    vi.mocked(searchAladinBooks).mockResolvedValue({ page: 2, pageSize: 20, totalResults: 40, items: [item("9780000000002")] });
    await expect(importAladinSelection(1, { ...request, targetBookId: null })).rejects.toThrow("변경");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM book_volumes").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM books").get()).toEqual({ n: 2 });
  });
  it("rejects a foreign target before calling the external service", async () => {
    await expect(importAladinSelection(1, { ...request, targetBookId: 2 })).rejects.toThrow();
    expect(searchAladinBooks).not.toHaveBeenCalled();
  });
});

describe("auth and backup compatibility", () => {
  it("reads an expired session without attempting a Server Component cookie mutation", async () => {
    expect(await getCurrentUser()).toBeNull(); expect(cookieDelete).not.toHaveBeenCalled();
  });
  it("enforces disabled registration at the action boundary", async () => {
    await expect(signupAction(new FormData())).rejects.toThrow("REDIRECT:/login");
  });
  it("accepts legacy SHA-256 and BCrypt while rejecting a wrong password", async () => {
    const password = "fixture-only-password";
    const legacy = createHash("sha256").update(password).digest("hex");
    expect(await verifyPassword(password, legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
    const bcrypt = await hashPassword(password);
    expect(await verifyPassword(password, `{bcrypt}${bcrypt}`)).toBe(true);
  });
  it("exports only owned records and imports them into the current owner's scope", async () => {
    volume(1); volume(2, 2);
    const exported = await exportExcelBackup(1, "fixture-admin");
    const imported = await importExcelBackup(2, new File([new Uint8Array(exported)], "backup.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    expect(imported.volumesCreated).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM books WHERE owner_id=1").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM book_volumes bv JOIN books b ON b.id=bv.book WHERE b.owner_id=2").get()).toEqual({ n: 2 });
  });
});


describe("Java-compatible manual book registration", () => {
  const book = { name: "직접 정한 제목", author: "직접 정한 저자", description: "직접 쓴 설명", type: "내 분류", totalVolume: "전 30권", coverUrl: "" };
  const selected = [{ page: 1, key: "9781111111111" }, { page: 1, key: "9781111111112", sideStory: true }, { page: 1, key: "9781111111113" }];
  function search() {
    vi.mocked(searchAladinBooks).mockResolvedValue({ page: 1, pageSize: 20, totalResults: 3, items: selected.map((entry) => ({ ...item(entry.key), author: "검색 저자", categoryName: "검색 분류" })) });
  }
  it("preserves entered metadata and numbers each selected side story independently", async () => {
    search();
    const result = await createManualBook(1, { book, direct: false, targetBookId: null, selection: selected });
    expect(sqlite.prepare("SELECT name,author,description,type,totalvolume FROM books WHERE id=?").get(result.bookId))
      .toEqual({ name: book.name, author: book.author, description: book.description, type: book.type, totalvolume: book.totalVolume });
    expect(sqlite.prepare("SELECT volume FROM book_volumes WHERE book=? ORDER BY id").all(result.bookId)).toEqual([{ volume: 1 }, { volume: null }, { volume: 2 }]);
    expect(getManualBookCategories()).toContain(book.type);
  });
  it("appends after MAX(volume), ignoring seq and specials, without changing existing metadata", async () => {
    volume(1, 1, 4); volume(2, 1, null);
    sqlite.prepare("UPDATE books SET type='기존 분류',totalvolume='전 12권' WHERE id=1").run();
    expect(getOwnedBookOptions(1)[0]).toMatchObject({ id: 1, nextVolume: 5, type: "기존 분류" });
    search();
    await createManualBook(1, { book, direct: false, targetBookId: 1, selection: selected });
    expect(sqlite.prepare("SELECT volume FROM book_volumes WHERE book=1 ORDER BY id").all()).toEqual([{ volume: 4 }, { volume: null }, { volume: 5 }, { volume: null }, { volume: 6 }]);
    expect(sqlite.prepare("SELECT name,type,totalvolume FROM books WHERE id=1").get()).toEqual({ name: "가나 100%_!\\", type: "기존 분류", totalvolume: "전 12권" });
  });
  it("allows explicit direct registration without Aladin configuration or calls", async () => {
    configured.mockReturnValue(false);
    const result = await createManualBook(1, { book, direct: true, targetBookId: null, selection: [] });
    expect(result.count).toBe(0); expect(searchAladinBooks).not.toHaveBeenCalled();
    await expect(createManualBook(1, { book, direct: true, targetBookId: 1, selection: [] })).rejects.toThrow("새 책");
  });
  it("allows a series-only fallback only after a fresh empty search and only for a new book", async () => {
    vi.mocked(searchAladinBooks).mockResolvedValue({ page: 1, pageSize: 20, totalResults: 0, items: [] });
    expect((await createManualBook(1, { book, direct: false, targetBookId: null, selection: [] })).count).toBe(0);
    await expect(createManualBook(1, { book, direct: false, targetBookId: 1, selection: [] })).rejects.toThrow("항목");
    search();
    await expect(createManualBook(1, { book, direct: false, targetBookId: null, selection: [] })).rejects.toThrow("항목");
  });
  it("rejects a foreign target and an unavailable Aladin search before writing", async () => {
    await expect(createManualBook(1, { book, direct: false, targetBookId: 2, selection: selected })).rejects.toThrow();
    expect(searchAladinBooks).not.toHaveBeenCalled();
    configured.mockReturnValue(false);
    await expect(createManualBook(1, { book, direct: false, targetBookId: null, selection: [] })).rejects.toThrow("설정");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM books").get()).toEqual({ n: 2 });
  });
  it("marks only the current owner's ISBNs and rejects duplicates at registration", async () => {
    volume(1); volume(2, 2);
    const result = { page: 1, pageSize: 20, totalResults: 2, items: [item("9780000000001"), item("9780000000002")] };
    expect(withOwnership(1, result).items.map((entry) => entry.owned)).toEqual([true, false]);
    vi.mocked(searchAladinBooks).mockResolvedValue(result);
    await expect(createManualBook(1, { book, direct: false, targetBookId: null, selection: [{ page: 1, key: "9780000000001" }] })).rejects.toThrow("이미 등록");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM books").get()).toEqual({ n: 2 });
  });
});


describe("canary audit inventory regressions", () => {
  const edit = { name: "edited", seq: "2", isbn13: "9780000000001", author: "", price: "", description: "", link: "", pubDate: "", coverUrl: "" };
  const offer = { branch: "SEOUL", branchName: "서울", grade: "상", title: "test",
    bookLink: "https://www.aladin.co.kr/branch/list", purchaseLink: "https://www.aladin.co.kr/offer/a", price: "4,000" };

  it.each(["9781111111111", ""])("invalidates both stable and uniquely linked legacy stocks when ISBN becomes %s", async (isbn13) => {
    volume(1); volume(2, 2); stock(1, 1, 1); stock(2, 1, null); stock(3, 2, 2);
    await updateVolume(1, 1, 1, { ...edit, isbn13 });
    expect(sqlite.prepare("SELECT id FROM branchbook ORDER BY id").all()).toEqual([{ id: 3 }]);
  });
  it("does not guess which duplicate-volume legacy stock belongs to an edited ISBN", async () => {
    volume(1); volume(2, 1, 1); stock(1, 1, 1); stock(2, 1, null); stock(3, 1, 2);
    await updateVolume(1, 1, 1, { ...edit, isbn13: "9781111111111" });
    expect(sqlite.prepare("SELECT id,book_volume_id FROM branchbook ORDER BY id").all()).toEqual([
      { id: 2, book_volume_id: null }, { id: 3, book_volume_id: 2 }
    ]);
  });
  it("keeps same-ISBN inventory and rolls back rejected duplicate ISBN edits", async () => {
    volume(1); volume(2, 1, 3); stock(1, 1, 1);
    await expect(updateVolume(1, 1, 1, { ...edit, isbn13: "9780000000002" })).rejects.toThrow();
    expect(sqlite.prepare("SELECT book_volume_id,volume FROM branchbook").get()).toEqual({ book_volume_id: 1, volume: 1 });
    await updateVolume(1, 1, 1, edit);
    expect(sqlite.prepare("SELECT book_volume_id,volume FROM branchbook").get()).toEqual({ book_volume_id: 1, volume: 2 });
  });
  it("retains different offers of the same grade and the real lowest price", async () => {
    volume(1); jobs.requestStockRefresh(1);
    vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: true, raw: {}, stocks: [offer,
      { ...offer, price: "9,000", purchaseLink: "https://www.aladin.co.kr/offer/b" }] });
    await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT COUNT(*) AS count, MIN(CAST(REPLACE(price, ',', '') AS INTEGER)) AS minimum FROM branchbook").get())
      .toEqual({ count: 2, minimum: 4000 });
  });
  it("chooses the minimum price for indistinguishable summaries in either order", async () => {
    volume(1);
    for (const prices of [["4,000", "9,000"], ["9,000", "4,000"]]) {
      jobs.requestStockRefresh(1);
      vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: true, raw: {}, stocks: prices.map((price) => ({ ...offer, price, purchaseLink: offer.bookLink })) });
      await jobs.processNextStockRefreshJob();
      expect(sqlite.prepare("SELECT price FROM branchbook").all()).toEqual([{ price: "4,000" }]);
    }
  });
  it("does not save prices or report success for a partial lookup", async () => {
    volume(1); jobs.requestStockRefresh(1);
    vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: true, partial: true, raw: {}, stocks: [{ ...offer, price: null, verified: false }] });
    await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM branchbook").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT success,empty,fail FROM stock_refresh_job").get()).toEqual({ success: 0, empty: 0, fail: 1 });
  });
  it("fences a superseded worker after its external lookup, before any result or summary write", async () => {
    volume(1); jobs.requestStockRefresh(1);
    vi.mocked(lookupUsedStocks).mockImplementationOnce(async () => {
      sqlite.prepare("UPDATE stock_refresh_job SET lock_token='replacement-worker',message='replacement' WHERE id=1").run();
      sqlite.prepare("INSERT INTO branch_inventory_summary(branch,branch_name,stock_count) VALUES ('NEW','new-job',7)").run();
      return { successful: true, raw: {}, stocks: [offer] };
    });
    await jobs.processNextStockRefreshJob();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM branchbook").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT status,lock_token,message FROM stock_refresh_job").get()).toEqual({ status: "RUNNING", lock_token: "replacement-worker", message: "replacement" });
    expect(sqlite.prepare("SELECT stock_count FROM branch_inventory_summary").all()).toEqual([{ stock_count: 7 }]);
  });
});
