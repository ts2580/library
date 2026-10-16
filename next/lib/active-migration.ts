import fs from "node:fs";
import path from "node:path";

// A successful Spring handover records only paths here, never credentials.
export function activeMigrationPaths(cwd: string): { databasePath: string; dataDir: string } | null {
  const pointer = path.join(cwd, "data", "active-migration.json");
  if (!fs.existsSync(pointer)) return null;
  const value = JSON.parse(fs.readFileSync(pointer, "utf8")) as Record<string, unknown>;
  if (value.version !== 1 || typeof value.dataDir !== "string") throw new Error("Invalid active migration record");
  const root = path.resolve(cwd, "data", "migrations");
  const dataDir = path.resolve(cwd, value.dataDir);
  if (path.dirname(dataDir) !== root || !/^handover-[a-f0-9-]+$/.test(path.basename(dataDir))) {
    throw new Error("Active migration must refer to a handover directory");
  }
  const databasePath = path.join(dataDir, "bookshelf.sqlite");
  if (!fs.existsSync(databasePath)) throw new Error("Active migration database is missing");
  return { databasePath, dataDir };
}
