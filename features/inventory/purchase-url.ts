import { normalizeHttpUrl } from "@/lib/urls";

function stockLink(value: string | null): string | null {
  const absolute = normalizeHttpUrl(value);
  if (absolute) return absolute;
  const relative = value?.trim();
  if (!relative?.startsWith("/")) return null;
  try {
    const url = new URL(relative, "https://www.aladin.co.kr");
    if (!["aladin.co.kr", "www.aladin.co.kr"].includes(url.hostname)) return null;
    return normalizeHttpUrl(url.href);
  } catch { return null; }
}

export function stockPurchaseUrl(stock: { purchaseUrl: string | null; bookLink: string | null }): string | null {
  return stockLink(stock.purchaseUrl) ?? stockLink(stock.bookLink);
}
