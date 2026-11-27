import { createHash } from "node:crypto";
import type { AladinBranchStock } from "@/features/aladin/types";

export function normalizedBranch(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Inventory identity is one book per branch, regardless of volume or offer URL. */
export function stockIdentity<T extends Pick<AladinBranchStock, "branch">>(bookId: number, stock: T): string {
  return createHash("sha256").update(JSON.stringify([bookId, normalizedBranch(stock.branch)])).digest("hex");
}

function price(value: string | null): number | null {
  const normalized = value?.replaceAll(",", "").trim() ?? "";
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

/** Keep one offer per branch, choosing the lowest known price. */
export function uniqueStocks(bookId: number, stocks: AladinBranchStock[]): AladinBranchStock[] {
  const selected = new Map<string, AladinBranchStock>();
  for (const stock of stocks) {
    const key = stockIdentity(bookId, stock);
    const previous = selected.get(key);
    const amount = price(stock.price);
    if (!previous || (amount != null && (price(previous.price) == null || amount < price(previous.price)!))) {
      selected.set(key, stock);
    }
  }
  return [...selected.values()];
}
