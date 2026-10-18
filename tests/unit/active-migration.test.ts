import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { activeMigrationPaths, resolveDataPaths } from "@/lib/active-migration";

const directories: string[] = [];
function root() {
  const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-active-"));
  directories.push(directory);
  return directory;
}
function handover(dataRoot: string, id = "aabb") {
  const dataDir = path.join(dataRoot, `migrations/handover-${id}`);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataRoot, "active-migration.json"), JSON.stringify({ version: 1, dataDir: `data/migrations/handover-${id}` }));
  const databasePath = path.join(dataDir, "bookshelf.sqlite");
  writeFileSync(databasePath, "fixture");
  return { databasePath, dataDir };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("resolves a relocated local handover from the root data directory", () => {
  const app = root(); const dataRoot = path.join(app, "data"); const expected = handover(dataRoot);
  expect(resolveDataPaths(app)).toEqual({ ...expected, dataRoot });
});
it("resolves a ca2 pointer at /data independently from the application directory", () => {
  const directory = root(); const app = path.join(directory, "app"); const dataRoot = path.join(directory, "data");
  const expected = handover(dataRoot);
  expect(resolveDataPaths(app, dataRoot, path.join(dataRoot, "bookshelf.sqlite"))).toEqual({ ...expected, dataRoot });
});
it("uses the selected data root for a fresh database and ignores other roots", () => {
  const app = root(); handover(path.join(app, "data")); const dataRoot = path.join(app, "custom");
  expect(resolveDataPaths(app, dataRoot)).toEqual({ dataRoot, dataDir: dataRoot, databasePath: path.join(dataRoot, "bookshelf.sqlite") });
});
it("honors an explicitly selected database even if a handover pointer exists", () => {
  const app = root(); const dataRoot = path.join(app, "data"); handover(dataRoot);
  const databasePath = path.join(dataRoot, "rehearsal.sqlite");
  expect(resolveDataPaths(app, dataRoot, databasePath)).toEqual({ dataRoot, dataDir: dataRoot, databasePath });
});
it("does not silently start an empty database when local ca2 data has not been moved", () => {
  const app = root(); handover(path.join(app, "next/data"));
  expect(() => resolveDataPaths(app)).toThrow("Move next/data");
});
it("does not reopen the Java original instead of an unmoved local handover", () => {
  const app = root(); handover(path.join(app, "next/data"));
  mkdirSync(path.join(app, "data"));
  writeFileSync(path.join(app, "data/bookshelf.sqlite"), "old Java database");
  expect(() => resolveDataPaths(app)).toThrow("Move next/data");
});
it("uses the root handover even if an old copy still exists", () => {
  const app = root(); handover(path.join(app, "next/data")); const dataRoot = path.join(app, "data"); const expected = handover(dataRoot, "ccdd");
  expect(resolveDataPaths(app)).toEqual({ ...expected, dataRoot });
});
it("does not fall back to an older database when the current pointer is broken", () => {
  const app = root(); handover(path.join(app, "next/data")); const current = handover(path.join(app, "data"), "ccdd");
  rmSync(current.databasePath);
  expect(() => resolveDataPaths(app)).toThrow("missing");
});
it.each(["../other", "/data/migrations/handover-aabb", "data/migrations/other", "data/migrations/handover-aabb/nested", "data/migrations/../migrations/handover-aabb"])("rejects an escaping or invalid pointer: %s", (dataDir) => {
  const directory = root(); handover(directory);
  writeFileSync(path.join(directory, "active-migration.json"), JSON.stringify({ version: 1, dataDir }));
  expect(() => activeMigrationPaths(directory)).toThrow("handover directory");
});
it("returns no handover for a new installation", () => {
  expect(activeMigrationPaths(root())).toBeNull();
});
