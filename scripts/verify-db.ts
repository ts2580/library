import "@/db";
import fs from "node:fs";
import { sqlite } from "@/db";
import { env } from "@/lib/env";
import { storedCoverPath } from "@/features/covers/service";

function count(sql: string, ...args: unknown[]): number {
  return Number((sqlite.prepare(sql).get(...args) as { count: number }).count);
}

const integrity = sqlite.pragma("integrity_check") as Array<Record<string, unknown>>;
const foreignKeys = sqlite.pragma("foreign_key_check") as Array<Record<string, unknown>>;
const ownerlessBooks = count("SELECT COUNT(*) AS count FROM books WHERE owner_id IS NULL");
const orphanVolumes = count("SELECT COUNT(*) AS count FROM book_volumes bv LEFT JOIN books b ON b.id = bv.book WHERE b.id IS NULL");
const ambiguousLegacyStocks = count(`
  SELECT COUNT(*) AS count FROM branchbook bb
  WHERE bb.book_volume_id IS NULL AND (
    SELECT COUNT(*) FROM book_volumes bv
    WHERE bv.book = bb.book AND bv.volume = bb.volume
  ) <> 1
`);
const missingCoverFiles = (sqlite.prepare(`
  SELECT cover FROM books WHERE cover LIKE '/covers/%' OR cover LIKE 'cover://%'
  UNION ALL
  SELECT cover FROM book_volumes WHERE cover LIKE '/covers/%' OR cover LIKE 'cover://%'
`).all() as Array<{ cover: string }>).filter(({ cover }) => {
  const target = storedCoverPath(cover);
  return !target || !fs.existsSync(target);
}).length;

const report = {
  database: env.databasePath,
  integrity,
  foreignKeyViolationCount: foreignKeys.length,
  ownerlessBooks,
  orphanVolumes,
  ambiguousLegacyStocks,
  missingCoverFiles
};
console.log(JSON.stringify(report, null, 2));
if (integrity.some((row) => !Object.values(row).includes("ok")) || foreignKeys.length || ownerlessBooks || orphanVolumes) process.exitCode = 1;
