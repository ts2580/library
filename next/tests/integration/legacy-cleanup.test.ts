import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import BetterSqlite3 from "better-sqlite3";

vi.mock("server-only", () => ({}));
const { LegacyCleanup } = await import("@/features/migration/legacy-cleanup");
let root: string, sourceDir: string, appRoot: string, dataDir: string, databasePath: string, backupFile: string;
let service: InstanceType<typeof LegacyCleanup>;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "bookshelf-cleanup-"));
  sourceDir = path.join(root, "legacy"); appRoot = path.join(root, "next"); dataDir = path.join(appRoot, "data/migrations/handover-aabb");
  databasePath = path.join(dataDir, "bookshelf.sqlite"); backupFile = path.join(dataDir, "backups/pre-next-bootstrap-fixture.sqlite");
  await fs.mkdir(path.join(sourceDir, "covers"), { recursive: true }); await fs.mkdir(path.join(dataDir, "covers"), { recursive: true }); await fs.mkdir(path.dirname(backupFile));
  await fs.writeFile(path.join(sourceDir, "covers/a.webp"), "fixture-cover"); await fs.writeFile(path.join(dataDir, "covers/a.webp"), "fixture-cover");
  const source = new BetterSqlite3(path.join(sourceDir, "bookshelf.sqlite"));
  source.exec(await fs.readFile(new URL("../fixtures/legacy-schema.sql", import.meta.url), "utf8"));
  source.exec("INSERT INTO member(id,username,password_hash) VALUES(1,'fixture-admin','hash'); INSERT INTO books(id,name,owner_id) VALUES(1,'fixture book',1); INSERT INTO book_volumes(id,book,volume) VALUES(1,1,1); INSERT INTO book_categories(name) VALUES('saved category');");
  source.close();
  await fs.copyFile(path.join(sourceDir, "bookshelf.sqlite"), backupFile); await fs.copyFile(backupFile, databasePath);
  const current = new BetterSqlite3(databasePath);
  current.exec("CREATE TABLE bookshelf_migrations(version INTEGER PRIMARY KEY,backup_path TEXT)");
  current.prepare("INSERT INTO bookshelf_migrations VALUES(1,?)").run(backupFile); current.close();
  await fs.writeFile(path.join(appRoot, "data/active-migration.json"), JSON.stringify({ version: 1, dataDir: "data/migrations/handover-aabb" }));
  service = new LegacyCleanup({ appRoot, sourceDir, dataDir, databasePath });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const exists = async (file: string) => fs.access(file).then(() => true, () => false);

describe("legacy original cleanup", () => {
  it("deletes only the original DB/covers and preserves the active DB, backup, logs and old manual backups", async () => {
    await fs.writeFile(path.join(sourceDir, "bookshelf.sqlite.back"), "keep backup"); await fs.mkdir(path.join(sourceDir, "logs"));
    expect((await service.status()).state).toBe("READY");
    expect((await service.remove()).state).toBe("CLEANED");
    expect(await exists(path.join(sourceDir, "bookshelf.sqlite"))).toBe(false); expect(await exists(path.join(sourceDir, "covers"))).toBe(false);
    expect(await exists(path.join(sourceDir, "bookshelf.sqlite.back"))).toBe(true); expect(await exists(path.join(sourceDir, "logs"))).toBe(true);
    const active = new BetterSqlite3(databasePath, { readonly: true });
    expect(active.prepare("SELECT COUNT(*) AS n FROM books").get()).toEqual({ n: 1 }); active.close();
    expect(await exists(backupFile)).toBe(true);
    expect((await service.remove()).state).toBe("CLEANED");
  });
  it("blocks while a process still holds the original DB", async () => {
    const source = new BetterSqlite3(path.join(sourceDir, "bookshelf.sqlite"));
    try { expect((await service.status()).state).toBe("BLOCKED"); await expect(service.remove()).rejects.toThrow("프로세스"); }
    finally { source.close(); }
    expect(await exists(path.join(sourceDir, "covers/a.webp"))).toBe(true);
  });
  it("rejects source changes after the handover even when row counts match", async () => {
    const source = new BetterSqlite3(path.join(sourceDir, "bookshelf.sqlite")); source.exec("UPDATE books SET name='new source change'"); source.close();
    await expect(service.remove()).rejects.toThrow("원본 DB가 변경"); expect(await exists(path.join(sourceDir, "bookshelf.sqlite"))).toBe(true);
  });
  it("rejects a missing or changed adopted cover", async () => {
    await fs.writeFile(path.join(dataDir, "covers/a.webp"), "changed cover");
    await expect(service.remove()).rejects.toThrow("표지가 다릅니다");
    await fs.unlink(path.join(dataDir, "covers/a.webp")); await expect(service.remove()).rejects.toThrow("찾을 수 없는");
    expect(await exists(path.join(sourceDir, "covers/a.webp"))).toBe(true);
  });
  it("rejects a missing pre-migration backup", async () => {
    await fs.unlink(backupFile); await expect(service.remove()).rejects.toThrow(); expect(await exists(path.join(sourceDir, "bookshelf.sqlite"))).toBe(true);
  });
  it("rejects the current DB as a cleanup source and refuses a rehearsal DB", async () => {
    expect((await new LegacyCleanup({ appRoot, sourceDir: dataDir, dataDir, databasePath }).status()).state).toBe("BLOCKED");
    const rehearsal = new LegacyCleanup({ appRoot, sourceDir, dataDir: sourceDir, databasePath: path.join(sourceDir, "bookshelf.sqlite") });
    await expect(rehearsal.remove()).rejects.toThrow("실제 이전본");
  });
  it("rejects symlinks and independent processes holding the cleanup lock", async () => {
    await fs.symlink(backupFile, path.join(sourceDir, "covers/symlink")); await expect(service.remove()).rejects.toThrow("심볼릭"); await fs.unlink(path.join(sourceDir, "covers/symlink"));
    const lock = new BetterSqlite3(path.join(dataDir, "legacy-cleanup-lock.sqlite")); lock.exec("BEGIN EXCLUSIVE");
    try { await expect(service.remove()).rejects.toThrow("다른 프로세스"); } finally { lock.exec("ROLLBACK"); lock.close(); }
    expect(await exists(path.join(sourceDir, "bookshelf.sqlite"))).toBe(true);
  });
  it("resumes staged deletion without deleting a newly reappearing original", async () => {
    const staging = path.join(sourceDir, ".next-cleanup-aabb"); await fs.mkdir(staging);
    for (const name of ["bookshelf.sqlite", "covers"]) await fs.rename(path.join(sourceDir, name), path.join(staging, name));
    await fs.writeFile(path.join(dataDir, "legacy-cleanup.json"), JSON.stringify({ version: 1, phase: "DELETING", staging, databaseBytes: 1, coverBytes: 1, coverFiles: 1 }));
    expect((await service.status()).state).toBe("RETRY"); expect((await service.remove()).state).toBe("CLEANED");
    expect(await exists(staging)).toBe(false);
    await fs.writeFile(path.join(sourceDir, "bookshelf.sqlite"), "a new original");
    await expect(service.remove()).rejects.toThrow("다시 생겼"); expect((await service.status()).state).toBe("BLOCKED");
  });
});
