import { createHash } from "node:crypto";
import type { AladinBranchStock } from "@/features/aladin/types";

function canonicalLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim() || null;
  }
}

/** Prices, volume numbers and display names must not define offer identity. */
export function stockIdentity(volumeId: number, stock: AladinBranchStock): string {
  const purchase = canonicalLink(stock.purchaseLink);
  const listing = canonicalLink(stock.bookLink);
  const offer = purchase && purchase !== listing ? purchase : null;
  const identity = [volumeId, stock.branch.trim(), offer ? "offer" : "summary", offer ?? stock.grade?.trim() ?? ""];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function price(value: string | null): number | null {
  const normalized = value?.replaceAll(",", "").trim() ?? "";
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

/** For indistinguishable summaries, select the cheapest known price, never the last row. */
export function uniqueStocks(volumeId: number, stocks: AladinBranchStock[]): AladinBranchStock[] {
  const selected = new Map<string, AladinBranchStock>();
  for (const stock of stocks) {
    const key = stockIdentity(volumeId, stock);
    const previous = selected.get(key);
    const amount = price(stock.price);
    if (!previous || (amount != null && (price(previous.price) == null || amount < price(previous.price)!))) {
      selected.set(key, stock);
    }
  }
  return [...selected.values()];
}
