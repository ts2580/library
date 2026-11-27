import "server-only";
import { canonicalIsbns, getOwnedAladinIdentifiers, isOwnedAladinItem } from "@/features/aladin/duplicates";
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
  const owned = getOwnedAladinIdentifiers(ownerId);
  const products = new Set([...owned.links].map(productId).filter((id): id is string => id != null));
  const matches = (item: AladinBookItem) => isOwnedAladinItem(owned, item)
    || products.has(item.itemId ?? productId(item.link) ?? "");
  const items: AladinBookItem[] = [];
  for (const item of result.items) {
    let resolved = item;
    // K/U codes in search HTML are not ISBNs. Resolve only otherwise-unmatched
    // products whose ISBN could match an existing volume, keeping preview order.
    if (!matches(item) && owned.isbns.size && item.itemId && !canonicalIsbns(item).size) {
      const detail = await hydrateAladinItem(item);
      resolved = { ...item, isbn: detail.isbn, isbn13: detail.isbn13 };
    }
    items.push({ ...resolved, owned: matches(resolved) });
  }
  return { ...result, items };
}
