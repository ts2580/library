import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const search = vi.hoisted(() => vi.fn());
vi.mock("@/features/aladin/service", () => ({ searchAladinBooks: search }));
vi.mock("@/features/aladin/client", () => ({ isAladinConfigured: () => true }));
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-metadata-"));
process.env.BOOKSHELF_DB_PATH = path.join(directory, "bookshelf.sqlite");
process.env.BOOKSHELF_DATA_DIR = directory;
const { sqlite } = await import("@/db");
const { requestMetadataEnrichment, getMetadataEnrichmentProgress, processNextMetadataEnrichmentJob } = await import("@/features/books/enrichment-job");

beforeEach(() => {
  sqlite.exec("DELETE FROM books; DELETE FROM member; INSERT INTO member(id,username,password_hash) VALUES(1,'owner','fixture'),(2,'foreign','fixture');");
  search.mockReset().mockImplementation(async ({ query }) => ({ items: [{ title: query, author: "API 저자", description: "API 설명", isbn13: null, isbn: null, link: "https://example.com/new-link" }] }));
});
afterAll(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

it("fills every owned book and volume with missing metadata, preserves existing values, and resumes per book", async () => {
  sqlite.exec(`INSERT INTO books(id,name,owner_id,author,description) VALUES
    (1,'첫 책',1,NULL,NULL),(2,'둘째 책',1,'기존 저자','기존 설명'),(3,'완성 책',1,'완성 저자','완성 설명'),
    (4,'다른 계정',2,NULL,NULL),(5,'검색 없음',1,NULL,NULL),(6,'실패 책',1,NULL,NULL);
    INSERT INTO book_volumes(id,book,volume,name,author,description,link) VALUES
    (1,1,1,'첫 권',NULL,'기존 권 설명','https://example.com/keep'),(2,2,1,'둘째 권',NULL,NULL,NULL),
    (3,3,1,'완성 권','완성 저자','완성 설명',NULL),(4,4,1,'타인 권',NULL,NULL,NULL);`);
  sqlite.prepare("UPDATE books SET author=? WHERE id=1").run("\t\n\u3000");
  search.mockImplementation(async ({ query }) => {
    if (query === "실패 책") throw new Error("upstream fixture");
    return { items: query === "검색 없음" ? [] : [{ title: query, author: "API 저자", description: "API 설명", isbn13: null, isbn: null, link: "https://example.com/new-link" }] };
  });
  expect(requestMetadataEnrichment(1)).toMatchObject({ status: "QUEUED", total: 4 });
  expect(() => requestMetadataEnrichment(1)).toThrow("이미 진행");
  await processNextMetadataEnrichmentJob();
  expect(getMetadataEnrichmentProgress(1)).toMatchObject({ status: "RUNNING", processed: 1 });
  for (let index = 0; index < 3; index++) await processNextMetadataEnrichmentJob();
  expect(getMetadataEnrichmentProgress(1)).toMatchObject({ status: "COMPLETED", processed: 4, booksUpdated: 1, volumesUpdated: 2, skipped: 1, failed: 1 });
  expect(sqlite.prepare("SELECT author,description FROM books WHERE id=1").get()).toEqual({ author: "API 저자", description: "API 설명" });
  expect(sqlite.prepare("SELECT author,description FROM books WHERE id=2").get()).toEqual({ author: "기존 저자", description: "기존 설명" });
  expect(sqlite.prepare("SELECT author,description,link FROM book_volumes WHERE id=1").get()).toEqual({ author: "API 저자", description: "기존 권 설명", link: "https://example.com/keep" });
  expect(sqlite.prepare("SELECT link FROM book_volumes WHERE id=2").get()).toEqual({ link: null });
  expect(sqlite.prepare("SELECT author,description FROM books WHERE id=4").get()).toEqual({ author: null, description: null });
  expect(search.mock.calls.flatMap(([input]) => input.query)).not.toContain("완성 권");
  expect(getMetadataEnrichmentProgress(2)).toBeNull();
  expect(await processNextMetadataEnrichmentJob()).toBe(false);
});

it("preserves edits made during lookup and skips a deleted target without stopping remaining books", async () => {
  sqlite.exec("INSERT INTO books(id,name,owner_id) VALUES(1,'삭제할 책',1),(2,'동시 수정 책',1)");
  requestMetadataEnrichment(1);
  sqlite.prepare("DELETE FROM books WHERE id=1").run();
  search.mockImplementation(async ({ query }) => {
    sqlite.prepare("UPDATE books SET author='직접 입력',description='직접 설명' WHERE id=2").run();
    return { items: [{ title: query, author: "API 저자", description: "API 설명" }] };
  });
  await processNextMetadataEnrichmentJob(); await processNextMetadataEnrichmentJob();
  expect(getMetadataEnrichmentProgress(1)).toMatchObject({ status: "COMPLETED", processed: 2, booksUpdated: 0, skipped: 2, failed: 0 });
  expect(sqlite.prepare("SELECT author,description FROM books WHERE id=2").get()).toEqual({ author: "직접 입력", description: "직접 설명" });
});

it("completes immediately when no metadata is missing and performs no API calls", () => {
  sqlite.exec("INSERT INTO books(id,name,owner_id,author,description) VALUES(1,'완성',1,'저자','설명')");
  expect(requestMetadataEnrichment(1)).toMatchObject({ status: "COMPLETED", total: 0 });
  expect(search).not.toHaveBeenCalled();
});
