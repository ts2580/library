import "server-only";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";
import * as relations from "@/db/relations";
import { bootstrapDatabase } from "@/db/bootstrap";
import { env } from "@/lib/env";

const globalForDb = globalThis as unknown as {
  bookshelfSqlite?: BetterSqlite3.Database;
  bookshelfDb?: ReturnType<typeof createDrizzle>;
};

function createDrizzle(sqlite: BetterSqlite3.Database) {
  return drizzle(sqlite, { schema: { ...schema, ...relations } });
}

function createConnection(): BetterSqlite3.Database {
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
  const sqlite = new BetterSqlite3(env.databasePath);
  try {
    bootstrapDatabase(sqlite);
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function connection(): BetterSqlite3.Database {
  return globalForDb.bookshelfSqlite ??= createConnection();
}

// Importing a route during `next build` must not open or migrate the runtime DB.
export const sqlite = new Proxy({} as BetterSqlite3.Database, {
  get(_target, key) {
    const client = connection();
    const value = Reflect.get(client, key, client);
    return typeof value === "function" ? value.bind(client) : value;
  }
});

export const db = new Proxy({} as ReturnType<typeof createDrizzle>, {
  get(_target, key) {
    const client = globalForDb.bookshelfDb ??= createDrizzle(connection());
    const value = Reflect.get(client, key, client);
    return typeof value === "function" ? value.bind(client) : value;
  }
});
