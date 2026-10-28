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
const { getBookList, getBookDetail, getBookTitle, getOwnedBookOptions, searchOwnedVolumes, getManualBookCategories } = await import("@/features/books/queries");
const { addVolume, updateVolume } = await import("@/features/books/service");
const { searchInventory, getStockRefreshProgress, getBranchStocks } = await import("@/features/inventory/queries");
const jobs = await import("@/features/inventory/service");
const refreshLogs = await import("@/features/inventory/refresh-log");
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
      expect(legacy.prepare("SELECT COUNT(*) AS count FROM bookshelf_migrations").get()).toEqual({ count: 6 });
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
  it.each([1, 2, 3, 4, 5])("upgrades an existing version-%s database without changing roles, inventory, or legacy links", version => {
    const prior = new BetterSqlite3(":memory:");
    try {
      bootstrapDatabase(prior);
      if (version === 1) prior.exec("ALTER TABLE stock_refresh_job DROP COLUMN scope_book_id; ALTER TABLE stock_refresh_job DROP COLUMN mode;");
      if (version < 3) prior.exec("ALTER TABLE stock_refresh_job DROP COLUMN run_id;");
      if (version < 4) prior.exec("DROP TABLE stock_refresh_completion;");
      if (version < 5) prior.exec("DROP TABLE stock_refresh_log; DROP TABLE stock_refresh_job_target;");
      prior.exec("DROP TABLE metadata_enrichment_job;");
      prior.prepare("DELETE FROM bookshelf_migrations WHERE version>?").run(version);
      prior.exec("INSERT INTO member(id,username,password_hash,role) VALUES(1,'fixture-admin','test','USER'); INSERT INTO books(id,name,owner_id) VALUES(1,'keep',1); INSERT INTO book_volumes(id,book,volume) VALUES(1,1,1); INSERT INTO branchbook(id,book,volume,price) VALUES(1,1,1,'900');");
      const before = prior.prepare("SELECT * FROM branchbook").all();
      bootstrapDatabase(prior); bootstrapDatabase(prior);
      expect(prior.prepare("SELECT * FROM branchbook").all()).toEqual(before);
      expect(prior.prepare("SELECT role FROM member WHERE id=1").get()).toEqual({ role: "USER" });
      expect(prior.prepare("SELECT mode,scope_book_id FROM stock_refresh_job").get()).toEqual({ mode: "REPLACE_ALL", scope_book_id: null });
      expect(prior.prepare("SELECT run_id FROM stock_refresh_job").get()).toEqual({ run_id: null });
      expect(prior.prepare("SELECT version FROM bookshelf_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);
      expect(prior.prepare("SELECT * FROM stock_refresh_completion").all()).toEqual([]);
    } finally { prior.close(); }
  });
  it("seeds a v3 terminal run into owner completion history exactly once", () => {
    const prior = new BetterSqlite3(":memory:");
    try {
      bootstrapDatabase(prior);
      prior.exec("DROP TABLE stock_refresh_completion; DROP TABLE stock_refresh_log; DROP TABLE stock_refresh_job_target; DROP TABLE metadata_enrichment_job; DELETE FROM bookshelf_migrations WHERE version>=4; INSERT INTO member(id,username,password_hash,role) VALUES(1,'fixture-admin','test','USER'); UPDATE stock_refresh_job SET requested_by=1,status='COMPLETED',run_id='before-upgrade'");
      bootstrapDatabase(prior); bootstrapDatabase(prior);
      expect(prior.prepare("SELECT * FROM stock_refresh_completion").all()).toEqual([{owner_id:1,run_id:"before-upgrade"}]);
      expect(prior.prepare("SELECT role FROM member WHERE id=1").get()).toEqual({role:"USER"});
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
    expect(getBookTitle(1, 2)).toBeNull();
    expect(getBookTitle(1, 1)).toBe("가나 100%_!\\");
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
  it.each([undefined, "SEOUL", "ALADIN_DROPSHIPPING"])("sorts inventory by book name and numeric volume for branch %s", branch => {
    sqlite.prepare("UPDATE books SET name='나무 시리즈' WHERE id=1").run();
    sqlite.prepare("INSERT INTO books(id,name,owner_id) VALUES(3,?,1)").run("가게 시리즈".normalize("NFD"));
    for (const [id, book, number] of [[1, 1, 10], [2, 3, 2], [3, 1, 2], [4, 3, 1], [5, 1, 1], [6, 1, null]] as const) volume(id, book, number);
    volume(7, 2); stock(99, 2, 7);
    let stockId = 1;
    for (const code of ["SEOUL", "ALADIN_DROPSHIPPING"]) {
      for (let id = 1; id <= 6; id++) {
        const target = sqlite.prepare("SELECT book,volume FROM book_volumes WHERE id=?").get(id) as {book:number;volume:number|null};
        stock(stockId, target.book, id, target.volume ?? 0);
        sqlite.prepare("UPDATE branchbook SET branch=?,grade=? WHERE id=?").run(code, target.book === 1 ? "A" : "Z", stockId++);
      }
    }
    const expected = [4, 2, 5, 3, 1, 6].flatMap(id => Array(branch ? 1 : 2).fill(`권 ${id}`));
    expect(searchInventory(1, { branch }).items.map(row => row.volumeName)).toEqual(expected);
    if (branch) expect(getBranchStocks(1, branch).map(row => row.volumeName)).toEqual(expected);
  });
  it("applies name sorting before inventory pagination and retains branch filters", () => {
    for (let index = 1; index <= 30; index++) {
      const id = index + 100;
      sqlite.prepare("INSERT INTO books(id,name,owner_id) VALUES(?,?,1)").run(id, `정렬 책 ${String(index).padStart(2, "0")}`);
      volume(id, id);
      stock(id, id, id);
    }
    const first = searchInventory(1, { branch: "SEOUL", page: 1 });
    const second = searchInventory(1, { branch: "SEOUL", page: 2 });
    expect(first.total).toBe(30);
    expect([...first.items, ...second.items].map(row => row.bookName)).toEqual(Array.from({length:30}, (_, i) => `정렬 책 ${String(i + 1).padStart(2, "0")}`));
    expect(second.items).toHaveLength(6);
    expect(searchInventory(1, { branch: "ALADIN_DROPSHIPPING" }).total).toBe(0);
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

describe("stock refresh logs and selected retries", () => {
  const offer = { branch: "SEOUL", branchName: "서울", grade: "상", title: "test", price: "2,000", bookLink: null, purchaseLink: null };
  function failure(id: number, owner = 1, book = 1) {
    sqlite.prepare("INSERT INTO stock_refresh_log(owner_id,book_id,volume_id,run_id,status,code,message) VALUES(?,?,?,?,'FAILED','FIXTURE','이전 실패')")
      .run(owner, book, id, `failed-${id}`);
  }
  it("records readable per-volume failures, empty results and successful results without exposing external credentials", async () => {
    for (let id = 1; id <= 6; id++) volume(id);
    volume(7, 2);
    sqlite.exec("UPDATE book_volumes SET isbn13=NULL WHERE id=1; UPDATE book_volumes SET isbn13='invalid' WHERE id=2");
    vi.mocked(lookupUsedStocks)
      .mockResolvedValueOnce({ successful: false, stocks: [], errorCode: "ALADIN_API_ERROR", errorMessage: "조회 거절 https://example.com/?ttbkey=private token=private" })
      .mockResolvedValueOnce({ successful: true, raw: {}, stocks: [offer], partial: true })
      .mockResolvedValueOnce({ successful: true, raw: {}, stocks: [] })
      .mockResolvedValueOnce({ successful: true, raw: {}, stocks: [offer] });
    jobs.requestStockRefresh(1); await jobs.processNextStockRefreshJob();
    const all = refreshLogs.getStockRefreshLogs(1, { status: "all" });
    expect(all.items.map(item => [item.volumeId, item.status, item.code])).toEqual([
      [6, "SUCCESS", "STOCK_FOUND"], [5, "EMPTY", "NO_STOCK"], [4, "FAILED", "STOCK_INCOMPLETE"],
      [3, "FAILED", "ALADIN_API_ERROR"], [2, "FAILED", "ISBN_INVALID"], [1, "FAILED", "ISBN_MISSING"]
    ]);
    expect(all.items[3]?.message).toBe("조회 거절 [외부 주소] token=[비밀값 제거]");
    expect(refreshLogs.getStockRefreshLogs(1).total).toBe(4);
    expect(getStockRefreshProgress(1).pendingFailures).toBe(4);
    expect(refreshLogs.getStockRefreshLogs(2).items).toEqual([]);
  });
  it.each(["success", "empty", "failed", "partial"])("retries only selected volumes and preserves unrelated inventory after %s", async outcome => {
    volume(1); volume(2); volume(3, 2); stock(1, 1, 1); stock(2, 1, 2); stock(3, 2, 3);
    failure(1); failure(2); failure(3, 2, 2);
    const otherStocks = sqlite.prepare("SELECT * FROM branchbook WHERE id IN (2,3)").all();
    vi.mocked(lookupUsedStocks).mockResolvedValue(outcome === "failed"
      ? { successful: false, stocks: [], errorCode: "ALADIN_TIMEOUT", errorMessage: "응답 시간 초과" }
      : { successful: true, raw: {}, stocks: outcome === "empty" ? [] : [offer], partial: outcome === "partial" });
    expect(jobs.retryStockRefresh(1, [1, 1]).started).toBe(true);
    expect(getStockRefreshProgress(1)).toMatchObject({ mode: "REFRESH_SELECTED", total: 1 });
    await jobs.processNextStockRefreshJob();
    expect(lookupUsedStocks).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT * FROM branchbook WHERE id IN (2,3)").all()).toEqual(otherStocks);
    const result = sqlite.prepare("SELECT price FROM branchbook WHERE book_volume_id=1").all();
    expect(result).toEqual(outcome === "empty" ? [] : [{ price: outcome === "success" ? "2,000" : "1,000" }]);
    expect(refreshLogs.getStockRefreshFailureCount(1)).toBe(["success", "empty"].includes(outcome) ? 1 : 2);
    expect(refreshLogs.getStockRefreshFailureCount(2)).toBe(1);
    expect(refreshLogs.getStockRefreshLogs(1, { status: "all" }).total).toBe(3);
  });
  it("snapshots all unresolved eligible failures, rejects foreign selections, and keeps targets on a conflicting request", async () => {
    volume(1); volume(2); volume(3, 2); volume(4); failure(1); failure(2); failure(3, 2, 2); failure(4);
    sqlite.exec("UPDATE book_volumes SET ispurchased=1 WHERE id=2; UPDATE book_volumes SET noneedtobuy=1 WHERE id=4");
    expect(() => jobs.retryStockRefresh(1, [1, 3])).toThrow("선택한 권");
    expect(getStockRefreshProgress(1).status).toBe("IDLE");
    expect(jobs.retryStockRefresh(1).started).toBe(true);
    const before = sqlite.prepare("SELECT * FROM stock_refresh_job_target").all();
    expect(before).toEqual([{ job_id: 1, volume_id: 1 }]);
    expect(jobs.retryStockRefresh(2, [3]).started).toBe(false);
    expect(sqlite.prepare("SELECT * FROM stock_refresh_job_target").all()).toEqual(before);
    vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: true, raw: {}, stocks: [] });
    await jobs.processNextStockRefreshJob();
    expect(refreshLogs.getFailedStockVolumeIds(1)).toEqual([]);
    expect(() => jobs.retryStockRefresh(1)).toThrow("갱신할 권이 없습니다");
  });
  it.each([false, true])("fences selected stock and log writes after cancellation, including a newer run: %s", async replacement => {
    volume(1); volume(2); stock(1, 1, 1); stock(2, 1, 2); failure(1);
    jobs.retryStockRefresh(1, [1]);
    vi.mocked(lookupUsedStocks).mockImplementationOnce(async () => {
      jobs.cancelStockRefresh(1, getStockRefreshProgress(1).runId!);
      if (replacement) jobs.retryStockRefresh(1, [2]);
      return { successful: true, raw: {}, stocks: [offer] };
    });
    await jobs.processNextStockRefreshJob();
    expect(refreshLogs.getStockRefreshLogs(1, { status: "all" }).total).toBe(1);
    expect(sqlite.prepare("SELECT id FROM branchbook ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(getStockRefreshProgress(1).status).toBe(replacement ? "QUEUED" : "CANCELLED");
  });
  it("logs a rate limited attempt and leaves unattempted failures eligible for the next retry", async () => {
    volume(1); volume(2); stock(1, 1, 1); failure(1); failure(2);
    jobs.retryStockRefresh(1);
    vi.mocked(lookupUsedStocks).mockRejectedValue(new AladinRateLimitError());
    await jobs.processNextStockRefreshJob();
    expect(getStockRefreshProgress(1)).toMatchObject({ status: "FAILED", processed: 1, fail: 1, pendingFailures: 2 });
    expect(refreshLogs.getStockRefreshLogs(1).items[0]).toMatchObject({ volumeId: 1, code: "ALADIN_RATE_LIMIT" });
    expect(sqlite.prepare("SELECT id FROM branchbook").all()).toEqual([{ id: 1 }]);
    sqlite.exec("DELETE FROM book_volumes WHERE id=1");
    expect(refreshLogs.getStockRefreshLogs(1, { status: "all" }).total).toBe(1);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("stock job lifecycle", () => {
  it("survives cancellation at claim time and processes the next job", async () => {
    volume(1); stock(1, 1, 1);
    jobs.requestStockRefresh(1);
    // Revoke the claim at the SQL boundary, before a separate SELECT can read it.
    sqlite.exec(`CREATE TEMP TRIGGER cancel_stock_claim AFTER UPDATE OF status ON stock_refresh_job
      WHEN OLD.status='QUEUED' AND NEW.status='RUNNING'
      BEGIN
        UPDATE stock_refresh_job SET status='CANCELLED',running=0,lock_token=NULL WHERE id=NEW.id;
      END`);
    try {
      await expect(jobs.processNextStockRefreshJob()).resolves.toBe(true);
      expect(getStockRefreshProgress(1)).toMatchObject({ status: "CANCELLED", running: false });
      expect(lookupUsedStocks).not.toHaveBeenCalled();
      expect(sqlite.prepare("SELECT COUNT(*) n FROM branchbook").get()).toEqual({ n: 1 });
    } finally {
      sqlite.exec("DROP TRIGGER cancel_stock_claim");
    }
    vi.mocked(lookupUsedStocks).mockResolvedValue({ successful: true, raw: {}, stocks: [] });
    expect(jobs.requestStockRefresh(1).started).toBe(true);
    await expect(jobs.processNextStockRefreshJob()).resolves.toBe(true);
    expect(getStockRefreshProgress(1).status).toBe("COMPLETED");
  });
  it("cancels a queued job without clearing inventory and allows another run", async () => {
    volume(1); volume(2, 2); stock(1, 1, 1); stock(2, 2, 2);
    jobs.requestStockRefresh(1);
    const runId = getStockRefreshProgress(1).runId!;
    jobs.cancelStockRefresh(1, runId);
    expect(getStockRefreshProgress(1)).toMatchObject({ status: "CANCELLED", running: false, failed: false, completionId: runId });
    expect(sqlite.prepare("SELECT id FROM branchbook ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await jobs.processNextStockRefreshJob()).toBe(false);
    jobs.cancelStockRefresh(1, runId);
    expect(jobs.requestStockRefresh(1).started).toBe(true);
    expect(() => jobs.cancelStockRefresh(1, runId)).toThrow("작업이 변경");
    expect(getStockRefreshProgress(1).status).toBe("QUEUED");
  });
  it("rejects cancellation by another owner and supports legacy jobs without a run ID", () => {
    jobs.requestStockRefresh(1);
    expect(() => jobs.cancelStockRefresh(2, getStockRefreshProgress(1).runId!)).toThrow("다른 계정");
    expect(getStockRefreshProgress(1).status).toBe("QUEUED");
    sqlite.exec("UPDATE stock_refresh_job SET run_id=NULL");
    jobs.cancelStockRefresh(1, null);
    expect(getStockRefreshProgress(1)).toMatchObject({ status: "CANCELLED", runId: null });
    expect(getStockRefreshProgress(1).completionId).toBeTruthy();
  });
  it.each([false, true])("fences an in-flight lookup after cancellation, including a replacement run: %s", async replacement => {
    volume(1); volume(2); volume(3); volume(4, 2); stock(4, 2, 4);
    const offer = { branch: "SEOUL", branchName: "서울", grade: "상", title: "test", price: "2,000", bookLink: null, purchaseLink: null };
    jobs.requestStockRefresh(1);
    const runId = getStockRefreshProgress(1).runId!;
    vi.mocked(lookupUsedStocks).mockResolvedValueOnce({ successful: true, raw: {}, stocks: [offer] })
      .mockImplementationOnce(async () => {
        jobs.cancelStockRefresh(1, runId);
        if (replacement) jobs.requestStockRefresh(1);
        return { successful: true, raw: {}, stocks: [offer] };
      });
    await jobs.processNextStockRefreshJob();
    expect(lookupUsedStocks).toHaveBeenCalledTimes(2);
    expect(getStockRefreshProgress(1)).toMatchObject({ status: replacement ? "QUEUED" : "CANCELLED", completionId: runId });
    expect(sqlite.prepare("SELECT book_volume_id FROM branchbook ORDER BY book_volume_id").all()).toEqual([{ book_volume_id: 1 }, { book_volume_id: 4 }]);
    expect(sqlite.prepare("SELECT stock_count,total_amount FROM branch_inventory_summary").get()).toEqual({ stock_count: 2, total_amount: 3000 });
    expect(sqlite.prepare("SELECT lock_token FROM stock_refresh_job").get()).toEqual({ lock_token: null });
  });
  it("retains each owner's completed run after another owner reuses the singleton", async () => {
    volume(1); volume(2, 2);
    vi.mocked(lookupUsedStocks).mockResolvedValue({ successful:true,raw:{},stocks:[] });
    expect(getStockRefreshProgress(1).completionId).toBeNull();
    jobs.requestStockRefresh(1); const a = getStockRefreshProgress(1).runId;
    await jobs.processNextStockRefreshJob();
    expect(getStockRefreshProgress(1).completionId).toBe(a);
    jobs.requestStockRefresh(2); const b = getStockRefreshProgress(2).runId;
    expect(getStockRefreshProgress(1)).toMatchObject({status:"QUEUED",completionId:a,total:0});
    expect(getStockRefreshProgress(1).runId).toBeUndefined();
    await jobs.processNextStockRefreshJob();
    expect(getStockRefreshProgress(1)).toMatchObject({status:"IDLE",completionId:a,total:0});
    expect(getStockRefreshProgress(2)).toMatchObject({status:"COMPLETED",completionId:b});
    expect(a).not.toBe(b);
    jobs.requestStockRefresh(1); configured.mockReturnValue(false);
    const failed = getStockRefreshProgress(1).runId;
    await jobs.processNextStockRefreshJob();
    expect(getStockRefreshProgress(1)).toMatchObject({status:"FAILED",completionId:failed});
    expect(failed).not.toBe(a);
    expect(getStockRefreshProgress(2).completionId).toBe(b);
    jobs.deleteOwnerInventory(1);
    expect(getStockRefreshProgress(1).completionId).not.toBe(failed);
  });
  it("retains interrupted owner completion through later jobs", async () => {
    sqlite.exec("UPDATE stock_refresh_job SET status='RUNNING',running=1,requested_by=1,run_id='interrupted-run'");
    jobs.recoverInterruptedStockJob();
    expect(getStockRefreshProgress(1)).toMatchObject({status:"FAILED",completionId:"interrupted-run"});
    jobs.requestStockRefresh(2); await jobs.processNextStockRefreshJob();
    expect(getStockRefreshProgress(1)).toMatchObject({status:"IDLE",completionId:"interrupted-run"});
  });
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
      { isbn13: "9780000000001", volume: 1 }, { isbn13: "9780000000002", volume: 2 }, { isbn13: "9780000000003", volume: 3 }
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
    vi.mocked(searchAladinBooks).mockImplementation(async (input: unknown) => ({ page: (input as { page: number }).page, pageSize: 20, totalResults: 40, items: [item("9780000000002")] }));
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
    expect(sqlite.prepare("SELECT * FROM stock_refresh_completion").all()).toEqual([]);
  });
});
