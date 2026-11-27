import "server-only";
import { sqlite } from "@/db";
import { withStockBrowser, stockBrowser } from "@/features/aladin/browser-session";
import { aladinHtml, type AladinRequestGroup } from "@/features/aladin/client";
import { parseProductPage, parseSearchPage, parseUsedPage, changed } from "@/features/aladin/html";
import { asIsbn13, isbn13CheckDigit, normalizedIsbn } from "@/features/aladin/item-key";
import { aladinSearchSchema, isbn13Schema, usedSourceSchema } from "@/features/aladin/validation";
import type { AladinBookItem, AladinBranchStock, AladinSearchResult, StockLookupResult } from "@/features/aladin/types";
import { AppError } from "@/lib/errors";

const cache = new Map<string, { until: number; value: unknown; bytes: number }>();
const pending = new Map<string, Promise<unknown>>();
let cacheBytes = 0;
async function cached<T>(key: string, ttl: number, read: () => Promise<T>, fresh = false): Promise<T> {
  if (stockBrowser.getStore()) return read();
  const now = Date.now();
  for (const [k, entry] of cache) if (entry.until <= now) { cacheBytes -= entry.bytes; cache.delete(k); }
  if (!fresh && cache.has(key)) return structuredClone(cache.get(key)!.value) as T;
  const requestKey = `${fresh ? "fresh:" : ""}${key}`;
  if (!pending.has(requestKey)) {
    pending.set(requestKey, read().then(value => {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes <= 1024 * 1024) {
        if (cache.has(key)) { cacheBytes -= cache.get(key)!.bytes; cache.delete(key); }
        while (cache.size >= 128 || cacheBytes + bytes > 8 * 1024 * 1024) {
          const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
        }
        cache.set(key, { until: Date.now() + ttl, value, bytes }); cacheBytes += bytes;
      }
      return value;
    }).finally(() => pending.delete(requestKey)));
  }
  return structuredClone(await pending.get(requestKey)) as T;
}

type ReadOptions = { fresh?: boolean; group?: AladinRequestGroup };

const sorts = { PublishTime: 5, Accuracy: 11, Title: 1, SalesPoint: 2, CustomerRating: 3, MyReviewCount: 4 };
export async function searchAladinBooks(input: unknown, { fresh = false, group = "interactive" }: ReadOptions = {}): Promise<AladinSearchResult> {
  const options = aladinSearchSchema.parse(input);
  const url = new URL("https://www.aladin.co.kr/search/wsearchresult.aspx");
  const field = options.queryType === "Keyword" ? "SearchWord" : `Key${options.queryType}`;
  const params = { [field]: options.query, SearchTarget: options.searchTarget === "eBook" ? "EBook" : options.searchTarget,
    SortOrder: sorts[options.sort], ViewRowCount: options.maxResults, page: options.page, ViewType: "Detail",
    KeyRecentPublish: options.recentPublishFilter, OutStock: Number(options.outOfStockFilter),
    ...(options.categoryId ? { CategorySearch: options.categoryId } : {}) };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const result = await cached(`${group}:${url}`, 300_000, async () => parseSearchPage(await aladinHtml(url.toString(), group), options.page), fresh);
  const sizes = { Big: "cover500", MidBig: "cover150", Mid: "cover150", Small: "coversum", Mini: "coversum", None: "" };
  return { ...result, items: result.items.map(item => ({ ...item, cover: options.cover === "None" ? null
    : item.cover?.replace(/\/(?:cover\d+|coversum)\//i, `/${sizes[options.cover]}/`) ?? null })) };
}

export async function getAladinProduct(itemId: string, { fresh = false, group = "interactive" }: ReadOptions = {}): Promise<AladinBookItem> {
  if (!/^\d+$/.test(itemId)) throw new AppError("알라딘 상품 번호가 올바르지 않습니다.", "ALADIN_INVALID_ITEM");
  return cached(`${group}:product:${itemId}`, 86_400_000, async () => parseProductPage(
    await aladinHtml(`https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`, group), itemId), fresh);
}

export async function hydrateAladinItem(item: AladinBookItem): Promise<AladinBookItem> {
  if (!item.itemId) return item;
  const detail = await getAladinProduct(item.itemId);
  const detailIsbn13 = asIsbn13(detail.isbn13 ?? detail.isbn);
  if ([item.isbn13, item.isbn].some(isbn => isbn && asIsbn13(isbn) !== detailIsbn13)) {
    throw new AppError("알라딘 상품의 ISBN이 변경되었습니다. 다시 검색해 주세요.", "ALADIN_ISBN_MISMATCH", 502);
  }
  const searchIsbn = normalizedIsbn(item.isbn);
  // Keep the verified ISBN10 for duplicate checks against legacy ISBN10-only rows.
  const isbn = detail.isbn ?? (searchIsbn?.length === 10 && asIsbn13(searchIsbn) === detailIsbn13 ? searchIsbn : null);
  // Selection uses the publication precision shown in the search preview.
  return { ...detail, isbn, pubDate: item.pubDate ?? detail.pubDate, cover: item.cover === null ? null : detail.cover };
}

function matchesStockIsbn(item: AladinBookItem, isbn: string) {
  const barcode = item.isbn ?? item.isbn13;
  if (!barcode) return false;
  return barcode.length === isbn.length ? barcode === isbn : asIsbn13(barcode) === asIsbn13(isbn);
}

async function exactProduct(isbn: string, group: AladinRequestGroup, freshDetail = false) {
  const result = await searchAladinBooks({ query: isbn, queryType: "Keyword", searchTarget: "All", maxResults: 25 }, { fresh: true, group });
  for (const item of result.items) {
    // A search row may derive its last digit from ISBN10 while the product page
    // publishes a different barcode. Only the detail can confirm that candidate.
    const sameLegacyPrefix = isbn.length === 13 && item.isbn?.length === 10 && `978${item.isbn.slice(0, 9)}` === isbn.slice(0, 12);
    if (item.isbn13 && !matchesStockIsbn(item, isbn) && !sameLegacyPrefix) continue;
    const detail = item.itemId ? await getAladinProduct(item.itemId, { group, fresh: freshDetail }) : item;
    if (matchesStockIsbn(detail, isbn)) return detail;
  }
  if (!result.totalResults && isbn.length === 13 && isbn13CheckDigit(isbn.slice(0, 12)) !== Number(isbn[12])) {
    throw new AppError("알라딘 검색 결과가 없고 ISBN-13 검증 숫자도 일치하지 않습니다. 책의 바코드에서 ISBN 전체를 확인해 주세요.", "ISBN_INVALID", 422);
  }
  throw new AppError("ISBN이 일치하는 알라딘 상품을 확인하지 못했습니다.", "ALADIN_ITEM_NOT_FOUND", 502);
}

async function usedOffers(itemId: string, group: AladinRequestGroup): Promise<AladinBranchStock[]> {
  const result: AladinBranchStock[] = [];
  const seen = new Set<string>();
  let snapshot: string | undefined;
  let privateCount = 0;
  for (let page = 1; page <= 100; page++) {
    const url = `https://www.aladin.co.kr/shop/UsedShop/wuseditemall.aspx?ItemId=${itemId}&TabType=0&Fix=1&page=${page}`;
    const current = parseUsedPage(await aladinHtml(url, group), itemId, 0, page);
    const signature = JSON.stringify([current.count, current.pages, current.totals]);
    if (snapshot != null && signature !== snapshot) changed("조회 중 알라딘 재고가 변경되었습니다.");
    snapshot = signature;
    for (const offer of current.offers) {
      if (seen.has(offer)) changed();
      seen.add(offer);
    }
    result.push(...current.stocks);
    privateCount += current.privateCount;
    if (seen.size > current.count) changed();
    if (current.count === 0 || page === current.pages) {
      const direct = result.filter(stock => stock.branch === "ALADIN_DROPSHIPPING").length;
      const stores = result.length - direct;
      // Store tab counts include copies not listed as separate online offers.
      // Verify all rendered pages and exact non-store totals instead of equating copies with rows.
      if (direct !== current.totals.direct || privateCount !== current.totals.private
        || stores > current.totals.store || (current.totals.store > 0 && !stores)) {
        changed("알라딘 중고 목록의 건수를 확인하지 못했습니다.");
      }
      return result;
    }
  }
  changed("알라딘 재고 페이지 한도를 초과했습니다.");
}

function productIdFromLink(link?: string | null) {
  const url = link && URL.canParse(link) ? new URL(link) : null;
  const id = url && ["www.aladin.co.kr", "aladin.co.kr"].includes(url.hostname)
    && url.pathname.toLowerCase() === "/shop/wproduct.aspx" ? url.searchParams.get("ItemId") : null;
  return id && /^\d+$/.test(id) ? id : null;
}

function needsProductCheck(error: unknown): error is AppError {
  return error instanceof AppError && (error.code === "ALADIN_FORMAT_CHANGED"
    || (error.code === "ALADIN_HTTP_ERROR" && /HTTP (404|410)\b/.test(error.message)));
}

async function verifyStockProduct(isbn: string, hint: string | null, fresh: boolean) {
  if (hint) {
    try {
      const detail = await getAladinProduct(hint, { group: "inventory", fresh });
      if (matchesStockIsbn(detail, isbn)) return hint;
    } catch (error) {
      if (!(error instanceof AppError && error.code === "ALADIN_ADULT_LOGIN_REQUIRED") && !needsProductCheck(error)) throw error;
    }
  }
  const product = await exactProduct(isbn, "inventory", fresh);
  if (!product.itemId) changed();
  return product.itemId;
}

async function inventoryOffers(isbn: string, link?: string | null) {
  const hint = productIdFromLink(link);
  if (stockBrowser.getStore()) {
    const itemId = await verifyStockProduct(isbn, hint, false);
    return { itemId, offers: await usedOffers(itemId, "inventory") };
  }

  const known = sqlite.prepare("SELECT item_id AS itemId, verified_at AS verifiedAt FROM aladin_inventory_product WHERE isbn=?")
    .get(isbn) as { itemId: string; verifiedAt: number } | undefined;
  let failedListing: AppError | undefined;
  if (known) {
    try {
      return { itemId: known.itemId, offers: await usedOffers(known.itemId, "inventory") };
    } catch (error) {
      if (!needsProductCheck(error)) throw error;
      failedListing = error;
      // Only invalidate the mapping that actually failed, even during concurrent refreshes.
      sqlite.prepare("DELETE FROM aladin_inventory_product WHERE isbn=? AND item_id=? AND verified_at=?")
        .run(isbn, known.itemId, known.verifiedAt);
    }
  }

  // On a broken listing, search the original ISBN again instead of trusting the old link.
  const verifiedAt = Date.now();
  const itemId = await verifyStockProduct(isbn, failedListing ? null : hint, Boolean(failedListing));
  if (failedListing && itemId === known?.itemId) throw failedListing;
  const offers = await usedOffers(itemId, "inventory");
  sqlite.prepare(`INSERT INTO aladin_inventory_product(isbn,item_id,verified_at) VALUES(?,?,?)
    ON CONFLICT(isbn) DO UPDATE SET item_id=excluded.item_id, verified_at=excluded.verified_at
    WHERE excluded.verified_at >= aladin_inventory_product.verified_at`).run(isbn, itemId, verifiedAt);
  return { itemId, offers };
}

async function interactiveOffers(isbn: string) {
  const { itemId } = await exactProduct(isbn, "interactive");
  if (!itemId) changed();
  return { itemId, offers: await usedOffers(itemId, "interactive") };
}

export async function lookupUsedStocks(isbnInput: string, sourceInput?: string, group: AladinRequestGroup = "interactive", productLink?: string | null, ownerId?: number): Promise<StockLookupResult> {
  const isbn = isbn13Schema.parse(isbnInput), source = usedSourceSchema.parse(sourceInput);
  const lookup = async (): Promise<StockLookupResult> => {
    const { itemId, offers } = group === "inventory" ? await inventoryOffers(isbn, productLink) : await interactiveOffers(isbn);
    const stocks = offers.filter(stock => source === "all"
      || (source === "dropshipping" ? stock.branch === "ALADIN_DROPSHIPPING" : stock.branch !== "ALADIN_DROPSHIPPING"));
    return { successful: true, stocks, raw: { itemId, source }, partial: false };
  };
  try {
    return await lookup().catch(error => {
      if (ownerId !== undefined && error instanceof AppError && error.code === "ALADIN_ADULT_LOGIN_REQUIRED") {
        const retry = withStockBrowser(ownerId, lookup);
        if (retry) return retry;
      }
      throw error;
    });
  } catch (error) {
    return { successful: false, stocks: [], errorCode: error instanceof AppError ? error.code
      : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "ALADIN_TIMEOUT"
      : error instanceof TypeError ? "ALADIN_NETWORK_ERROR" : "ALADIN_LOOKUP_FAILED",
      errorMessage: error instanceof AppError ? error.message
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "알라딘 응답 시간이 초과되었습니다."
        : error instanceof TypeError ? "알라딘 서버에 연결하지 못했습니다." : "알라딘 재고 조회에 실패했습니다." };
  }
}
