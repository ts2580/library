import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import BetterSqlite3 from "better-sqlite3";

vi.mock("server-only", () => ({}));
const root = mkdtempSync(path.join(tmpdir(), "bookshelf-handover-"));
process.env.BOOKSHELF_DB_PATH = path.join(root, "target-unused.sqlite");
process.env.BOOKSHELF_DATA_DIR = root;
process.env.BOOKSHELF_LEGACY_OWNER_USERNAME = "fixture-admin";
const { bootstrapDatabase } = await import("@/db/bootstrap");
const { prepareHandover } = await import("@/features/migration/handover");
const { activeMigrationPaths } = await import("@/lib/active-migration");
let number = 0;
let directory: string;
beforeEach(() => { directory = path.join(root, String(++number)); mkdirSync(directory); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

function source() {
  const filename = path.join(directory, "source.sqlite");
  const db = new BetterSqlite3(filename);
  db.exec(readFileSync(new URL("../fixtures/legacy-schema.sql", import.meta.url), "utf8"));
  db.pragma("journal_mode = WAL"); db.pragma("wal_autocheckpoint = 0");
  db.exec("INSERT INTO member(id,username,password_hash) VALUES(1,'fixture-admin','legacy-hash'); INSERT INTO books(id,name,owner_id,cover,type) VALUES(1,'legacy series',1,'/covers/fixture.webp','현재 분류'); INSERT INTO book_volumes(id,book,volume,seq) VALUES(1,1,3,99); INSERT INTO book_categories(name) VALUES('아직 사용하지 않은 분류');");
  const covers = path.join(directory, "covers"); mkdirSync(covers); writeFileSync(path.join(covers, "fixture.webp"), Buffer.from([1,2,3,4]));
  return { db, filename, covers };
}
describe("one-click legacy handover", () => {
  it("copies committed WAL data and covers, preserves IDs and categories, and never upgrades the source", async () => {
    const fixture = source();
    const destination = path.join(directory, "destination");
    const phases: string[] = [];
    try {
      const result = await prepareHandover({ sourceDatabase: fixture.filename, sourceCovers: fixture.covers, destination, owner: "fixture-admin", progress: async (phase) => { phases.push(phase); }, bootstrap: bootstrapDatabase });
      expect(result.before.books).toBe(1); expect(result.after.books).toBe(1); expect(result.after.book_volumes).toBe(1);
      expect(result.coverFiles).toBe(1); expect(result.missingCovers).toBe(0);
      expect(phases).toContain("MIGRATING");
      expect(readFileSync(path.join(destination, "covers/fixture.webp"))).toEqual(Buffer.from([1,2,3,4]));
      const adopted = new BetterSqlite3(path.join(destination, "bookshelf.sqlite"), { readonly: true });
      try {
        expect(adopted.prepare("SELECT id,seq,volume FROM book_volumes").get()).toEqual({ id: 1, seq: 99, volume: 3 });
        expect(adopted.prepare("SELECT name FROM book_categories WHERE name = ?").get("아직 사용하지 않은 분류")).toBeDefined();
        expect(adopted.prepare("SELECT role FROM member").get()).toEqual({ role: "ADMIN" });
      } finally { adopted.close(); }
      expect(fixture.db.prepare("SELECT name FROM sqlite_master WHERE name='app_sessions'").get()).toBeUndefined();
      expect(fixture.db.prepare("SELECT name FROM sqlite_master WHERE name='bookshelf_migrations'").get()).toBeUndefined();
    } finally { fixture.db.close(); }
  });
  it("rejects another account or a multi-user database before copying", async () => {
    const fixture = source();
    try {
      const input = { sourceDatabase: fixture.filename, sourceCovers: fixture.covers, destination: path.join(directory, "target"), owner: "wrong", progress: async () => {}, bootstrap: bootstrapDatabase };
      await expect(prepareHandover(input)).rejects.toThrow("한 명");
      expect(existsSync(path.join(input.destination, "bookshelf.sqlite"))).toBe(false);
      fixture.db.exec("INSERT INTO member(username,password_hash) VALUES('other','hash')");
      await expect(prepareHandover({ ...input, owner: "fixture-admin" })).rejects.toThrow("한 명");
    } finally { fixture.db.close(); }
  });
  it("does not overwrite an existing target", async () => {
    const fixture = source();
    const destination = path.join(directory, "target"); mkdirSync(destination); writeFileSync(path.join(destination, "bookshelf.sqlite"), "keep-me");
    try {
      await expect(prepareHandover({ sourceDatabase: fixture.filename, sourceCovers: fixture.covers, destination, owner: "fixture-admin", progress: async () => {}, bootstrap: bootstrapDatabase })).rejects.toThrow("이미");
      expect(readFileSync(path.join(destination, "bookshelf.sqlite"), "utf8")).toBe("keep-me");
    } finally { fixture.db.close(); }
  });
  it("rejects symlink covers instead of copying files outside the cover root", async () => {
    const fixture = source(); symlinkSync(fixture.filename, path.join(fixture.covers, "outside-link"));
    try {
      await expect(prepareHandover({ sourceDatabase: fixture.filename, sourceCovers: fixture.covers, destination: path.join(directory, "target"), owner: "fixture-admin", progress: async () => {}, bootstrap: bootstrapDatabase })).rejects.toThrow("심볼릭");
    } finally { fixture.db.close(); }
  });
  it("rejects missing cover storage when the source references local covers", async () => {
    const fixture = source();
    try {
      await expect(prepareHandover({ sourceDatabase: fixture.filename, sourceCovers: path.join(directory, "missing"), destination: path.join(directory, "target"), owner: "fixture-admin", progress: async () => {}, bootstrap: bootstrapDatabase })).rejects.toThrow("표지 폴더");
    } finally { fixture.db.close(); }
  });
  it("resolves a completed handover and fails closed for missing or escaping paths", () => {
    const app = path.join(directory, "app"); const target = path.join(app, "data/migrations/handover-aabb"); mkdirSync(target, { recursive: true });
    const pointer = path.join(app, "data/active-migration.json");
    writeFileSync(pointer, JSON.stringify({ version: 1, dataDir: "data/migrations/handover-aabb" }));
    expect(() => activeMigrationPaths(app)).toThrow("missing");
    writeFileSync(path.join(target, "bookshelf.sqlite"), "fixture");
    expect(activeMigrationPaths(app)?.databasePath).toBe(path.join(target, "bookshelf.sqlite"));
    writeFileSync(pointer, JSON.stringify({ version: 1, dataDir: "../other" }));
    expect(() => activeMigrationPaths(app)).toThrow("handover directory");
  });
});
