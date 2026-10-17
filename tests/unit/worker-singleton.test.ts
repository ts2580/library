import { afterEach, describe, expect, it } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { acquireWorkerLock } from "@/worker/singleton";

const directories: string[] = [];
function fixture() { const dir = mkdtempSync(path.join(tmpdir(), "bookshelf-worker-lock-")); directories.push(dir); return dir; }
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("single worker per DB", () => {
  it("rejects duplicate workers without holding a write lock on the application DB", () => {
    const database = path.join(fixture(), "bookshelf.sqlite");
    const release = acquireWorkerLock(database);
    try {
      expect(() => acquireWorkerLock(database)).toThrow("이미");
      const db = new BetterSqlite3(database);
      try { db.exec("CREATE TABLE test(id INTEGER); INSERT INTO test VALUES(1)"); }
      finally { db.close(); }
    } finally { release(); }
    acquireWorkerLock(database)();
  });
  it.skipIf(process.platform === "win32")("uses the same lock through a directory symlink", () => {
    const dir = fixture(); const alias = path.join(fixture(), "alias"); symlinkSync(dir, alias, "dir");
    const release = acquireWorkerLock(path.join(dir, "bookshelf.sqlite"));
    try { expect(() => acquireWorkerLock(path.join(alias, "bookshelf.sqlite"))).toThrow("이미"); }
    finally { release(); }
  });
  it("releases the process lock after a worker crash", async () => {
    const database = path.join(fixture(), "bookshelf.sqlite");
    const child = fork(fileURLToPath(new URL("../fixtures/worker-lock-holder.ts", import.meta.url)), [database], {
      execArgv: ["--import", "tsx"], silent: true
    });
    const exited = once(child, "exit");
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("worker startup timeout")), 5000);
        child.once("message", () => { clearTimeout(timeout); resolve(); });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error("worker exited before ready")); });
      });
      expect(() => acquireWorkerLock(database)).toThrow("이미");
    } finally { child.kill("SIGKILL"); await exited; }
    acquireWorkerLock(database)();
  }, 15_000);
});
