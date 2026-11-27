import "server-only";
import { sqlite } from "@/db";
import { asIsbn13 } from "@/features/aladin/item-key";
import type { AladinBookItem } from "@/features/aladin/types";

type Identifiers = Pick<AladinBookItem, "isbn13" | "isbn" | "link">;

export function canonicalIsbns(item: Pick<Identifiers, "isbn13" | "isbn">): Set<string> {
  return new Set([asIsbn13(item.isbn13), asIsbn13(item.isbn)].filter((value): value is string => value != null));
}

export function getOwnedAladinIdentifiers(ownerId: number) {
  const rows = sqlite.prepare(`SELECT bv.isbn13,bv.isbn,bv.link FROM book_volumes bv
    JOIN books b ON b.id=bv.book WHERE b.owner_id=?`).all(ownerId) as Identifiers[];
  const isbns = new Set<string>(), links = new Set<string>();
  for (const row of rows) {
    for (const isbn of canonicalIsbns(row)) isbns.add(isbn);
    if (row.link) links.add(row.link);
  }
  return { isbns, links };
}

export function isOwnedAladinItem(owned: ReturnType<typeof getOwnedAladinIdentifiers>, item: Identifiers): boolean {
  return [...canonicalIsbns(item)].some(isbn => owned.isbns.has(isbn)) || Boolean(item.link && owned.links.has(item.link));
}
