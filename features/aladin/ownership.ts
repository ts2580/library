import "server-only";
import { getOwnedAladinIdentifiers, isOwnedAladinItem } from "@/features/aladin/duplicates";
import type { AladinSearchResult } from "@/features/aladin/types";

export function withOwnership(ownerId: number, result: AladinSearchResult): AladinSearchResult {
  const owned = getOwnedAladinIdentifiers(ownerId);
  return { ...result, items: result.items.map(item => ({ ...item, owned: isOwnedAladinItem(owned, item) })) };
}
