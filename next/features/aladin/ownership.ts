import "server-only";
import { sqlite } from "@/db";
import type { AladinSearchResult } from "@/features/aladin/types";

export function withOwnership(ownerId: number, result: AladinSearchResult): AladinSearchResult {
  const owned = sqlite.prepare(`SELECT 1 FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ? AND (bv.isbn13 = ? OR bv.isbn = ?) LIMIT 1`);
  return { ...result, items: result.items.map((item) => {
    const key = item.isbn13 ?? item.isbn;
    return { ...item, owned: Boolean(key && owned.get(ownerId, key, key)) };
  }) };
}
