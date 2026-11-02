import BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const busy = (error: unknown) => error != null && typeof error === "object" && "code" in error
  && ["SQLITE_BUSY", "SQLITE_LOCKED"].includes(String(error.code));
export const ALADIN_MAX_CONCURRENT_REQUESTS = 10;

/** Each slot holds an OS-backed SQLite lock throughout a request. Crashes release
 * slots without a lease expiry that could overlap a still-running request. */
async function acquireSlot(filename: string): Promise<BetterSqlite3.Database> {
  for (;;) {
    for (let index = 0; index < ALADIN_MAX_CONCURRENT_REQUESTS; index++) {
      const slot = new BetterSqlite3(`${filename}.slot-${index}`, { timeout: 0 });
      try { slot.exec("BEGIN IMMEDIATE"); return slot; }
      catch (error) { slot.close(); if (!busy(error)) throw error; }
    }
    await delay(50);
  }
}

/** Web and worker share start spacing, server cooldown and ten in-flight slots.
 * The state lock is short-lived; network response time does not block other slots.
 * Never remove the sidecar or its slot files while either process is running. */
export async function withRequestGate<T>(filename: string, interval: number,
  request: (cooldown: (milliseconds: number) => Promise<void>) => Promise<T>): Promise<T> {
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new BetterSqlite3(filename, { timeout: 0 });
  let slot: BetterSqlite3.Database | undefined;
  let pending: Promise<T> | undefined;
  let stateQueue: Promise<unknown> = Promise.resolve();
  function locked<R>(action: () => R): Promise<R> {
    const result = stateQueue.then(() => lockedNow(action));
    stateQueue = result.catch(() => {});
    return result;
  }
  async function lockedNow<R>(action: () => R): Promise<R> {
    const deadline = Date.now() + 120_000;
    for (;;) {
      try { db.exec("BEGIN IMMEDIATE"); break; }
      catch (error) {
        if (!busy(error) || Date.now() >= deadline) throw error;
        await delay(50);
      }
    }
    try {
      const result = action();
      // Retrying COMMIT must never replay an action that already started HTTP.
      for (;;) {
        try { db.exec("COMMIT"); return result; }
        catch (error) {
          if (!busy(error) || Date.now() >= deadline) throw error;
          await delay(50);
        }
      }
    } finally { if (db.inTransaction) db.exec("ROLLBACK"); }
  }
  const cooldown = async (ms: number) => {
    const until = Date.now() + ms;
    // A callback may report a cooldown synchronously at admission. Let the short
    // start transaction finish before acquiring the same connection again.
    await Promise.resolve();
    await locked(() => {
      db.prepare("UPDATE request_state SET cooldown_until=MAX(cooldown_until,?),next_at=MAX(next_at,?) WHERE id=1").run(until, until);
    });
  };
  try {
    await locked(() => {
      db.exec("CREATE TABLE IF NOT EXISTS request_state (id INTEGER PRIMARY KEY CHECK(id=1), next_at INTEGER NOT NULL, cooldown_until INTEGER NOT NULL DEFAULT 0)");
      const columns = db.pragma("table_info(request_state)") as Array<{ name: string }>;
      if (!columns.some(column => column.name === "cooldown_until")) {
        db.exec("ALTER TABLE request_state ADD COLUMN cooldown_until INTEGER NOT NULL DEFAULT 0");
        db.prepare("UPDATE request_state SET cooldown_until=next_at WHERE next_at>?").run(Date.now() + interval);
      }
      db.exec("INSERT OR IGNORE INTO request_state (id,next_at) VALUES (1,0)");
    });
    slot = await acquireSlot(filename);
    for (;;) {
      const wait = await locked(() => {
        const state = db.prepare("SELECT next_at,cooldown_until FROM request_state WHERE id=1").get() as {next_at:number;cooldown_until:number};
        const now = Date.now();
        if (state.cooldown_until - now > 30_000) throw new Error("ALADIN_COOLDOWN");
        const wait = Math.max(state.next_at, state.cooldown_until) - now;
        if (wait <= 0) {
          // Invoke before releasing the start lock; SQLite commit latency must not
          // shorten the spacing between actual HTTP starts in different processes.
          try { pending = Promise.resolve(request(cooldown)); }
          catch (error) { pending = Promise.reject(error); }
          void pending.catch(() => {});
          db.prepare("UPDATE request_state SET next_at=? WHERE id=1").run(Date.now() + interval);
        }
        return wait;
      });
      if (wait <= 0) break;
      // Recheck shared cooldowns without holding the state lock while waiting.
      await delay(Math.min(wait, 1000));
    }
    return await pending!;
  } finally {
    // Even a failed state commit must drain its admitted request before releasing its slot.
    if (pending) await pending.catch(() => {});
    if (slot) { if (slot.inTransaction) slot.exec("ROLLBACK"); slot.close(); }
    if (db.inTransaction) db.exec("ROLLBACK");
    db.close();
  }
}
