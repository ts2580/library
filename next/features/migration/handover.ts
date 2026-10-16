import "server-only";
import BetterSqlite3 from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export type Counts = Record<"member" | "books" | "book_volumes" | "branchbook" | "book_categories", number>;
export type HandoverReport = { before: Counts; after: Counts; coverFiles: number; coverBytes: number; missingCovers: number };
export type Progress = (phase: string, percent: number, message: string) => Promise<void>;

function counts(db: BetterSqlite3.Database): Counts {
  return Object.fromEntries(["member", "books", "book_volumes", "branchbook", "book_categories"].map((table) =>
    [table, (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n])) as Counts;
}

function assertHealthy(db: BetterSqlite3.Database) {
  if (db.pragma("integrity_check", { simple: true }) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) {
    throw new Error("DB 무결성 또는 외래키 검사에 실패했습니다.");
  }
}

export async function prepareHandover(input: {
  sourceDatabase: string; sourceCovers: string; destination: string; owner: string;
  progress: Progress; bootstrap: (db: BetterSqlite3.Database) => void;
}): Promise<HandoverReport> {
  const { sourceDatabase, sourceCovers, destination, owner, progress, bootstrap } = input;
  if (path.resolve(sourceDatabase) === path.join(path.resolve(destination), "bookshelf.sqlite")) throw new Error("원본 DB를 덮어쓸 수 없습니다.");
  await fs.mkdir(destination, { recursive: true });
  const target = path.join(destination, "bookshelf.sqlite");
  try { await fs.lstat(target); throw new Error("이전 대상 DB가 이미 있습니다. 새 작업으로 다시 시도하세요."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const source = new BetterSqlite3(sourceDatabase, { readonly: true, fileMustExist: true });
  let before: Counts;
  try {
    assertHealthy(source);
    before = counts(source);
    const member = source.prepare("SELECT username FROM member").all() as Array<{ username: string }>;
    if (member.length !== 1 || member[0].username.toLowerCase() !== owner.toLowerCase()) {
      throw new Error("이 자동 이전은 현재 관리자 한 명만 사용하는 DB에서 실행할 수 있습니다.");
    }
    await progress("COPYING", 15, "일관된 SQLite 스냅샷을 만들고 있습니다.");
    await source.backup(target);
  } finally { source.close(); }

  let coverFiles = 0, coverBytes = 0;
  async function copyCovers(from: string, to: string): Promise<void> {
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) throw new Error("표지 폴더에 심볼릭 링크가 있습니다. 이전을 중단했습니다.");
    if (stat.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      for (const entry of await fs.readdir(from)) await copyCovers(path.join(from, entry), path.join(to, entry));
    } else if (stat.isFile()) {
      const content = await fs.readFile(from);
      await fs.copyFile(from, to, 1 /* COPYFILE_EXCL */);
      const copied = await fs.readFile(to);
      if (createHash("sha256").update(content).digest("hex") !== createHash("sha256").update(copied).digest("hex")) {
        throw new Error("표지 파일 복사 검증에 실패했습니다.");
      }
      coverFiles++; coverBytes += stat.size;
      if (coverFiles % 100 === 0) await progress("COPYING", 35, `표지 ${coverFiles.toLocaleString("ko-KR")}개를 복사했습니다.`);
    } else throw new Error("지원하지 않는 표지 파일 형식입니다.");
  }
  try {
    await copyCovers(sourceCovers, path.join(destination, "covers"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A missing root is allowed only when the snapshot has no local covers.
    const check = new BetterSqlite3(target, { readonly: true });
    try {
      const local = check.prepare("SELECT cover FROM books WHERE cover LIKE '/covers/%' OR cover LIKE 'cover://%' UNION ALL SELECT cover FROM book_volumes WHERE cover LIKE '/covers/%' OR cover LIKE 'cover://%'").all();
      if (local.length) throw new Error("기존 표지 폴더를 찾을 수 없습니다.");
      await fs.mkdir(path.join(destination, "covers"), { recursive: true });
    } finally { check.close(); }
  }

  await progress("MIGRATING", 65, "복사본에 Next.js 스키마를 적용하고 있습니다.");
  const db = new BetterSqlite3(target);
  try {
    bootstrap(db);
    assertHealthy(db);
    const after = counts(db);
    for (const table of ["member", "books", "book_volumes", "branchbook"] as const) {
      if (before[table] !== after[table]) throw new Error(`${table} 데이터 개수가 달라졌습니다.`);
    }
    const ownerless = (db.prepare("SELECT COUNT(*) AS n FROM books WHERE owner_id IS NULL").get() as { n: number }).n;
    if (ownerless) throw new Error("소유자 없는 도서가 남아 있습니다.");
    let missingCovers = 0;
    const covers = db.prepare("SELECT cover FROM books UNION ALL SELECT cover FROM book_volumes").all() as Array<{ cover: string | null }>;
    for (const { cover } of covers) {
      if (!cover?.startsWith("/covers/") && !cover?.startsWith("cover://")) continue;
      const relative = cover.startsWith("cover://") ? cover.slice(8) : cover.slice(8);
      const file = path.resolve(destination, "covers", relative);
      if (!file.startsWith(path.resolve(destination, "covers") + path.sep)) throw new Error("잘못된 표지 경로가 있습니다.");
      try { await fs.access(file); } catch { missingCovers++; }
    }
    return { before, after, coverFiles, coverBytes, missingCovers };
  } finally { db.close(); }
}
