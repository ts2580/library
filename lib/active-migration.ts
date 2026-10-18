import fs from "node:fs";
import path from "node:path";

// ca2 records use data/migrations/...; resolve that portable path inside the
// configured data root, including /data when the app itself lives at /app.
export function activeMigrationPaths(dataRoot: string): { databasePath: string; dataDir: string } | null {
  const pointer = path.join(dataRoot, "active-migration.json");
  if (!fs.existsSync(pointer)) return null;
  const value = JSON.parse(fs.readFileSync(pointer, "utf8")) as Record<string, unknown>;
  if (value.version !== 1 || typeof value.dataDir !== "string") throw new Error("Invalid active migration record");
  if (!/^data\/migrations\/handover-[a-f0-9-]+$/.test(value.dataDir)) {
    throw new Error("Active migration must refer to a handover directory");
  }
  const dataDir = path.resolve(dataRoot, "migrations", path.basename(value.dataDir));
  const databasePath = path.join(dataDir, "bookshelf.sqlite");
  if (!fs.existsSync(databasePath)) throw new Error("Active migration database is missing");
  return { databasePath, dataDir };
}

export function resolveDataPaths(cwd: string, directory = "./data", database?: string) {
  const dataRoot = path.resolve(cwd, directory);
  const defaultDatabase = path.join(dataRoot, "bookshelf.sqlite");
  const databasePath = database ? path.resolve(cwd, database) : defaultDatabase;
  const active = databasePath === defaultDatabase ? activeMigrationPaths(dataRoot) : null;
  if (!active && databasePath === defaultDatabase && dataRoot === path.join(cwd, "data")
      && ["active-migration.json", "bookshelf.sqlite"].some((name) => fs.existsSync(path.join(cwd, "next", "data", name)))) {
    throw new Error("Move next/data to the root data directory before starting Bookshelf. See docs/ONE_CLICK_MIGRATION.md.");
  }
  return { dataRoot, databasePath: active?.databasePath ?? databasePath, dataDir: active?.dataDir ?? dataRoot };
}
