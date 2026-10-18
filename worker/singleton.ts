import BetterSqlite3 from "better-sqlite3";
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * One worker per local application DB. A separate DELETE-journal DB holds the
 * process-lifetime lock, so no long transaction is held on bookshelf.sqlite.
 * Never unlink this lock file: doing so could create two different lock inodes.
 */
export function acquireWorkerLock(databasePath: string): () => void {
  const absolute = path.resolve(databasePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const canonical = existsSync(absolute) ? realpathSync(absolute)
    : path.join(realpathSync(path.dirname(absolute)), path.basename(absolute));
  const lockPath = `${canonical}.worker-lock.sqlite`;
  closeSync(openSync(lockPath, "a", 0o600));
  const lock = new BetterSqlite3(lockPath, { timeout: 0 });
  try {
    lock.pragma("busy_timeout = 0");
    lock.pragma("journal_mode = DELETE");
    lock.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    lock.close();
    if (error && typeof error === "object" && "code" in error
      && ["SQLITE_BUSY", "SQLITE_LOCKED"].includes(String(error.code))) {
      throw new Error("이미 이 DB의 워커가 실행 중입니다. 중복 워커는 시작하지 않습니다.");
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { if (lock.inTransaction) lock.exec("ROLLBACK"); }
    finally { lock.close(); }
  };
}
