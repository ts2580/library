import "@/db";
import { sqlite } from "@/db";
import { env } from "@/lib/env";

const integrity = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
const counts = Object.fromEntries(["member", "books", "book_volumes", "branchbook"].map((table) => [
  table,
  (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
]));
console.log(JSON.stringify({ database: env.databasePath, integrity, counts }, null, 2));
