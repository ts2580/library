import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { activeMigrationPaths } from "@/lib/active-migration";
import { AppError } from "@/lib/errors";
import type { CleanupStatus } from "@/features/migration/types";

type Config = { appRoot: string; sourceDir: string; dataDir: string; databasePath: string };
type Receipt = { version: 1; phase: "DELETING" | "COMPLETED"; staging: string; databaseBytes: number; coverBytes: number; coverFiles: number; completedAt?: string };
const names = ["bookshelf.sqlite", "bookshelf.sqlite-wal", "bookshelf.sqlite-shm", "covers"];
const busy = globalThis as typeof globalThis & { bookshelfLegacyCleanup?: boolean };
const blocked = (message: string) => new AppError(message, "LEGACY_CLEANUP_BLOCKED", 409);
const overlaps = (a: string, b: string) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);

async function exists(file: string) { try { await fs.lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function noLink(file: string) { const stat = await fs.lstat(file); if (stat.isSymbolicLink()) throw blocked("심볼릭 링크가 있는 원본은 자동 삭제할 수 없습니다."); return stat; }
async function filesIn(directory: string): Promise<Array<{ file: string; bytes: number }>> {
  if (!await exists(directory)) return [];
  const result: Array<{ file: string; bytes: number }> = [];
  async function walk(file: string) {
    const stat = await noLink(file);
    if (stat.isDirectory()) for (const name of await fs.readdir(file)) await walk(path.join(file, name));
    else if (stat.isFile()) result.push({ file, bytes: stat.size });
    else throw blocked("일반 파일이 아닌 원본이 있어 삭제를 중단했습니다.");
  }
  await walk(directory); return result;
}

// The migration bridge shares a Linux process namespace with Spring. A direct
// local installation also exposes the original Java process here.
async function assertUnused(source: string, staging?: string) {
  if (process.platform !== "linux") throw blocked("자동 원본 삭제는 Linux에서만 지원합니다. 기존 Java를 종료한 뒤 직접 정리하세요.");
  for (const pid of await fs.readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    let descriptors: string[];
    try { descriptors = await fs.readdir(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of descriptors) {
      let target: string;
      try { target = await fs.readlink(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (target === path.join(source, "bookshelf.sqlite") || target === path.join(source, "bookshelf.sqlite-wal")
          || target.startsWith(path.join(source, "covers") + path.sep) || (staging && target.startsWith(staging + path.sep))) {
        throw blocked("기존 DB 또는 표지를 사용 중인 프로세스가 있습니다. Spring과 기존 작업을 종료한 뒤 다시 시도하세요.");
      }
    }
  }
}

function healthy(db: BetterSqlite3.Database) {
  if (db.pragma("integrity_check", { simple: true }) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) throw blocked("DB 무결성 검사에 실패했습니다. 원본을 보존합니다.");
}
function tableHash(db: BetterSqlite3.Database, table: string) {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  const order = columns.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(",");
  const hash = createHash("sha256"); hash.update(JSON.stringify(columns.map(({ name }) => name)));
  for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).iterate()) hash.update(JSON.stringify(row));
  return hash.digest("hex");
}

async function verifiedBackup(target: string, database: string) {
  const current = new BetterSqlite3(database, { readonly: true, fileMustExist: true });
  try {
    healthy(current);
    const migration = current.prepare("SELECT backup_path FROM bookshelf_migrations WHERE version=1").get() as { backup_path: string | null } | undefined;
    if (!migration?.backup_path || !/^pre-next-bootstrap-.*\.sqlite$/.test(path.basename(migration.backup_path))) throw blocked("이전 전 자동 DB 백업이 없습니다. 원본을 보존합니다.");
    const file = path.join(target, "backups", path.basename(migration.backup_path));
    await noLink(file);
    if (!(await fs.realpath(file)).startsWith(target + path.sep)) throw blocked("이전 백업 경로가 올바르지 않습니다.");
    const backup = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
    try { healthy(backup); } finally { backup.close(); }
    return file;
  } finally { current.close(); }
}

export class LegacyCleanup {
  constructor(private readonly config: Config) {}

  private async context() {
    const active = activeMigrationPaths(this.config.appRoot);
    if (!active) throw blocked("원클릭 이전 완료 후에 기존 데이터를 삭제할 수 있습니다.");
    if (await fs.realpath(this.config.databasePath) !== await fs.realpath(active.databasePath)
        || await fs.realpath(this.config.dataDir) !== await fs.realpath(active.dataDir)) throw blocked("현재 앱이 실제 이전본을 사용하지 않습니다. 원본을 보존합니다.");
    const source = path.resolve(this.config.sourceDir);
    const target = await fs.realpath(active.dataDir);
    if (overlaps(source, target) || overlaps(source, path.resolve(this.config.dataDir))) throw blocked("현재 데이터와 원본 경로가 겹쳐 삭제할 수 없습니다.");
    if (await exists(source)) {
      await noLink(source);
      if (await fs.realpath(source) !== source) throw blocked("원본 경로에 심볼릭 링크가 있습니다.");
    }
    return { source, target, database: active.databasePath, receiptFile: path.join(target, "legacy-cleanup.json") };
  }
  private async receipt(file: string): Promise<Receipt | null> {
    if (!await exists(file)) return null;
    const value = JSON.parse(await fs.readFile(file, "utf8")) as Receipt;
    if (value.version !== 1 || !["DELETING", "COMPLETED"].includes(value.phase)) throw blocked("원본 정리 기록을 확인할 수 없습니다.");
    return value;
  }
  private async save(file: string, receipt: Receipt) {
    await fs.writeFile(file + ".tmp", JSON.stringify(receipt, null, 2), { mode: 0o600 });
    await fs.rename(file + ".tmp", file);
  }
  private validStaging(source: string, staging: string) {
    return path.dirname(staging) === source && /^\.next-cleanup-[a-f0-9-]+$/.test(path.basename(staging));
  }

  async status(): Promise<CleanupStatus> {
    const base = { canDelete: false, databaseBytes: 0, coverBytes: 0, coverFiles: 0 };
    try {
      const context = await this.context(); const receipt = await this.receipt(context.receiptFile);
      if (receipt?.phase === "DELETING") {
        if (!this.validStaging(context.source, receipt.staging)) throw blocked("원본 정리 경로가 일치하지 않습니다.");
        return { ...base, databaseBytes: receipt.databaseBytes, coverBytes: receipt.coverBytes, coverFiles: receipt.coverFiles, state: "RETRY", canDelete: !busy.bookshelfLegacyCleanup, message: "중단된 원본 정리를 이어서 완료할 수 있습니다." };
      }
      const database = path.join(context.source, "bookshelf.sqlite");
      const covers = path.join(context.source, "covers");
      if (!await exists(database) && !await exists(covers)) return { ...base, state: receipt ? "CLEANED" : "NOT_FOUND", message: "기존 DB와 표지가 없습니다. 새 책장 데이터는 유지됩니다." };
      if (receipt?.phase === "COMPLETED") throw blocked("원본 정리 후 기존 경로에 데이터가 다시 생겼습니다. 자동 재삭제를 중단합니다.");
      if (!await exists(database)) throw blocked("원본 DB가 없어 남은 표지를 검증할 수 없습니다.");
      await assertUnused(context.source);
      const stat = await noLink(database); const coversList = await filesIn(covers);
      return { state: "READY", canDelete: !busy.bookshelfLegacyCleanup, message: "이전본·백업·표지를 다시 검증한 뒤 기존 DB와 표지만 삭제합니다. 기존 백업 파일과 로그는 보존합니다.", databaseBytes: stat.size, coverFiles: coversList.length, coverBytes: coversList.reduce((sum, item) => sum + item.bytes, 0) };
    } catch (error) {
      return { ...base, state: "BLOCKED", message: error instanceof AppError ? error.message : "이전 상태나 원본 경로를 확인할 수 없습니다. 원본을 보존합니다." };
    }
  }

  async remove(): Promise<CleanupStatus> {
    if (busy.bookshelfLegacyCleanup) throw blocked("이미 원본 데이터를 정리 중입니다.");
    busy.bookshelfLegacyCleanup = true;
    let lease: BetterSqlite3.Database | undefined;
    try {
      const context = await this.context(); const previous = await this.receipt(context.receiptFile);
      try {
        lease = new BetterSqlite3(path.join(context.target, "legacy-cleanup-lock.sqlite"));
        lease.pragma("busy_timeout = 0"); lease.exec("BEGIN EXCLUSIVE");
      } catch { throw blocked("이미 다른 프로세스에서 원본 데이터를 정리 중입니다."); }
      if (previous?.phase === "DELETING") {
        if (!this.validStaging(context.source, previous.staging)) throw blocked("원본 정리 경로가 일치하지 않습니다.");
        await verifiedBackup(context.target, context.database);
        for (const name of names) if (await exists(path.join(/* turbopackIgnore: true */ context.source, name))) throw blocked("정리 도중 원본 경로가 변경되었습니다. 자동 삭제를 중단합니다.");
        await assertUnused(context.source, previous.staging);
        await filesIn(previous.staging);
        await fs.rm(previous.staging, { recursive: true, force: true });
        await this.save(context.receiptFile, { ...previous, phase: "COMPLETED", completedAt: new Date().toISOString() });
        return this.status();
      }
      if (previous?.phase === "COMPLETED") {
        for (const name of names) if (await exists(path.join(/* turbopackIgnore: true */ context.source, name))) throw blocked("이미 정리한 원본 경로에 데이터가 다시 생겼습니다.");
        return this.status();
      }
      const database = path.join(context.source, "bookshelf.sqlite");
      if (!await exists(database)) throw blocked("삭제할 원본 DB가 없습니다.");
      for (const name of names) if (await exists(path.join(/* turbopackIgnore: true */ context.source, name))) await noLink(path.join(/* turbopackIgnore: true */ context.source, name));
      await assertUnused(context.source);
      let source: BetterSqlite3.Database | undefined;
      let backup: BetterSqlite3.Database | undefined;
      let coverFiles: Array<{ file: string; bytes: number }>;
      try {
        const backupFile = await verifiedBackup(context.target, context.database);
        source = new BetterSqlite3(database, { fileMustExist: true });
        source.pragma("busy_timeout = 0"); source.exec("BEGIN EXCLUSIVE");
        healthy(source);
        backup = new BetterSqlite3(backupFile, { readonly: true, fileMustExist: true }); healthy(backup);
        for (const table of ["member", "books", "book_volumes", "branchbook", "book_categories"]) {
          if (tableHash(source, table) !== tableHash(backup, table)) throw blocked("이전 후 원본 DB가 변경되었습니다. 원본을 보존합니다.");
        }
        coverFiles = await filesIn(path.join(context.source, "covers"));
        if (coverFiles.length) await noLink(path.join(context.target, "covers"));
        for (const item of coverFiles) {
          const adopted = path.join(context.target, "covers", path.relative(path.join(context.source, "covers"), item.file));
          if (!await exists(adopted)) throw blocked("새 책장에서 찾을 수 없는 원본 표지가 있습니다. 원본을 보존합니다.");
          await noLink(adopted);
          if (!(await fs.realpath(adopted)).startsWith(path.join(context.target, "covers") + path.sep)) throw blocked("표지 경로가 이전본 밖을 가리킵니다.");
          if (createHash("sha256").update(await fs.readFile(item.file)).digest("hex") !== createHash("sha256").update(await fs.readFile(adopted)).digest("hex")) throw blocked("원본과 이전본의 표지가 다릅니다. 원본을 보존합니다.");
        }
      } finally {
        if (source?.inTransaction) source.exec("ROLLBACK"); source?.close(); backup?.close();
      }
      await assertUnused(context.source);
      const databaseBytes = (await fs.stat(database)).size;
      const staging = path.join(context.source, `.next-cleanup-${randomUUID()}`);
      const receipt: Receipt = { version: 1, phase: "DELETING", staging, databaseBytes, coverFiles: coverFiles!.length, coverBytes: coverFiles!.reduce((sum, item) => sum + item.bytes, 0) };
      await fs.mkdir(staging, { mode: 0o700 });
      const moved: string[] = [];
      try {
        for (const name of names) if (await exists(path.join(/* turbopackIgnore: true */ context.source, name))) {
          await fs.rename(path.join(/* turbopackIgnore: true */ context.source, name), path.join(staging, name)); moved.push(name);
        }
        await this.save(context.receiptFile, receipt);
      } catch (error) {
        for (const name of moved.reverse()) await fs.rename(path.join(staging, name), path.join(/* turbopackIgnore: true */ context.source, name));
        await fs.rmdir(staging); throw error;
      }
      await fs.rm(staging, { recursive: true });
      await this.save(context.receiptFile, { ...receipt, phase: "COMPLETED", completedAt: new Date().toISOString() });
      return this.status();
    } finally {
      if (lease?.inTransaction) lease.exec("ROLLBACK"); lease?.close();
      busy.bookshelfLegacyCleanup = false;
    }
  }
}
