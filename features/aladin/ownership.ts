import "server-only";
import { sqlite } from "@/db";
import { asIsbn13 } from "@/features/aladin/item-key";
import { hydrateAladinItem } from "@/features/aladin/service";
import type { AladinBookItem, AladinSearchResult } from "@/features/aladin/types";

function productId(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    if (!["http:", "https:"].includes(url.protocol) || !["aladin.co.kr", "www.aladin.co.kr"].includes(url.hostname)
      || url.username || url.password || url.port || url.pathname.toLowerCase() !== "/shop/wproduct.aspx") return null;
    const id = [...url.searchParams].find(([key]) => key.toLowerCase() === "itemid")?.[1];
    return id && /^\d+$/.test(id) ? id : null;
  } catch { return null; }
}

export async function withOwnership(ownerId: number, result: AladinSearchResult): Promise<AladinSearchResult> {
  const volumes = sqlite.prepare(`SELECT bv.isbn13, bv.isbn, bv.link FROM book_volumes bv
    JOIN books b ON b.id = bv.book WHERE b.owner_id = ?`).all(ownerId) as Array<{
      isbn13: string | null; isbn: string | null; link: string | null;
    }>;
  const isbns = new Set(volumes.flatMap(volume => [asIsbn13(volume.isbn13), asIsbn13(volume.isbn)]).filter(Boolean));
  const links = new Set(volumes.map(volume => volume.link).filter(Boolean));
  const products = new Set(volumes.map(volume => productId(volume.link)).filter(Boolean));
  const matches = (item: AladinBookItem) => [item.isbn13, item.isbn].some(isbn => Boolean(isbn && isbns.has(asIsbn13(isbn))))
    || Boolean(item.link && links.has(item.link)) || products.has(item.itemId ?? productId(item.link));
  const items: AladinBookItem[] = [];
  for (const item of result.items) {
    let resolved = item;
    // K/U codes in search HTML are not ISBNs. Resolve only otherwise-unmatched
    // products whose ISBN could match an existing volume, keeping preview order.
    if (!matches(item) && isbns.size && item.itemId && !asIsbn13(item.isbn13) && !asIsbn13(item.isbn)) {
      const detail = await hydrateAladinItem(item);
      resolved = { ...item, isbn: detail.isbn, isbn13: detail.isbn13 };
    }
    items.push({ ...resolved, owned: matches(resolved) });
  }
  return { ...result, items };
}
