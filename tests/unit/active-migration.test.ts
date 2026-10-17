import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { activeMigrationPaths } from "@/lib/active-migration";

const directories: string[] = [];
function root() {
  const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-active-"));
  directories.push(directory);
  return directory;
}
function handover(appRoot: string, id = "aabb") {
  const dataDir = path.join(appRoot, `data/migrations/handover-${id}`);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(appRoot, "data/active-migration.json"), JSON.stringify({ version: 1, dataDir: `data/migrations/handover-${id}` }));
  const databasePath = path.join(dataDir, "bookshelf.sqlite");
  writeFileSync(databasePath, "fixture");
  return { databasePath, dataDir };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("continues to resolve the Docker /app/data handover layout", () => {
  const app = root(); const expected = handover(app);
  expect(activeMigrationPaths(app)).toEqual(expected);
});
it("finds a local ca2 handover left under next/data after sources move to root", () => {
  const app = root(); const expected = handover(path.join(app, "next"));
  expect(activeMigrationPaths(app)).toEqual(expected);
});
it("prefers an explicitly relocated root handover over the old local copy", () => {
  const app = root(); handover(path.join(app, "next")); const expected = handover(app, "ccdd");
  expect(activeMigrationPaths(app)).toEqual(expected);
});
it("does not fall back to an older database when the current pointer is broken", () => {
  const app = root(); handover(path.join(app, "next")); const current = handover(app, "ccdd");
  rmSync(current.databasePath);
  expect(() => activeMigrationPaths(app)).toThrow("missing");
});
it.each(["../other", "data/migrations/other", "data/migrations/handover-aabb/nested"])("rejects an escaping or invalid old pointer: %s", (dataDir) => {
  const app = root(); handover(path.join(app, "next"));
  writeFileSync(path.join(app, "next/data/active-migration.json"), JSON.stringify({ version: 1, dataDir }));
  expect(() => activeMigrationPaths(app)).toThrow("handover directory");
});
it("uses a new installation only when neither handover pointer exists", () => {
  expect(activeMigrationPaths(root())).toBeNull();
});
