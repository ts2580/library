import "server-only";
import { aladinHtml } from "@/features/aladin/client";
import { parseProductPage, parseSearchPage, parseUsedPage, changed } from "@/features/aladin/html";
import { asIsbn13 } from "@/features/aladin/item-key";
import { aladinSearchSchema, isbn13Schema, usedSourceSchema } from "@/features/aladin/validation";
import type { AladinBookItem, AladinBranchStock, AladinSearchResult, StockLookupResult } from "@/features/aladin/types";
import { AppError } from "@/lib/errors";

const cache = new Map<string, { until: number; value: unknown; bytes: number }>();
const pending = new Map<string, Promise<unknown>>();
let cacheBytes = 0;
async function cached<T>(key: string, ttl: number, read: () => Promise<T>, fresh = false): Promise<T> {
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

const sorts = { PublishTime: 5, Accuracy: 11, Title: 1, SalesPoint: 2, CustomerRating: 3, MyReviewCount: 4 };
export async function searchAladinBooks(input: unknown, { fresh = false } = {}): Promise<AladinSearchResult> {
  const options = aladinSearchSchema.parse(input);
  const url = new URL("https://www.aladin.co.kr/search/wsearchresult.aspx");
  const field = options.queryType === "Keyword" ? "SearchWord" : `Key${options.queryType}`;
  const params = { [field]: options.query, SearchTarget: options.searchTarget === "eBook" ? "EBook" : options.searchTarget,
    SortOrder: sorts[options.sort], ViewRowCount: options.maxResults, page: options.page, ViewType: "Detail",
    KeyRecentPublish: options.recentPublishFilter, OutStock: Number(options.outOfStockFilter),
    ...(options.categoryId ? { CategorySearch: options.categoryId } : {}) };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const result = await cached(url.toString(), 300_000, async () => parseSearchPage(await aladinHtml(url.toString()), options.page), fresh);
  const sizes = { Big: "cover500", MidBig: "cover150", Mid: "cover150", Small: "coversum", Mini: "coversum", None: "" };
  return { ...result, items: result.items.map(item => ({ ...item, cover: options.cover === "None" ? null
    : item.cover?.replace(/\/(?:cover\d+|coversum)\//i, `/${sizes[options.cover]}/`) ?? null })) };
}

export async function getAladinProduct(itemId: string, { fresh = false } = {}): Promise<AladinBookItem> {
  if (!/^\d+$/.test(itemId)) throw new AppError("알라딘 상품 번호가 올바르지 않습니다.", "ALADIN_INVALID_ITEM");
  return cached(`product:${itemId}`, 86_400_000, async () => parseProductPage(
    await aladinHtml(`https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`), itemId), fresh);
}

export async function hydrateAladinItem(item: AladinBookItem): Promise<AladinBookItem> {
  if (!item.itemId) return item;
  const detail = await getAladinProduct(item.itemId);
  if (item.isbn13 && asIsbn13(detail.isbn13 ?? detail.isbn) !== asIsbn13(item.isbn13)) {
    throw new AppError("알라딘 상품의 ISBN이 변경되었습니다. 다시 검색해 주세요.", "ALADIN_ISBN_MISMATCH", 502);
  }
  // Selection uses the publication precision shown in the search preview.
  return { ...detail, pubDate: item.pubDate ?? detail.pubDate, cover: item.cover === null ? null : detail.cover };
}

async function exactProduct(isbn: string) {
  const result = await searchAladinBooks({ query: isbn, queryType: "Keyword", searchTarget: "All", maxResults: 25 }, { fresh: true });
  for (const item of result.items) {
    if (item.isbn13 && asIsbn13(item.isbn13) !== asIsbn13(isbn)) continue;
    const detail = item.itemId ? await getAladinProduct(item.itemId) : item;
    if (asIsbn13(detail.isbn13 ?? detail.isbn) === asIsbn13(isbn)) return detail;
  }
  throw new AppError("ISBN이 일치하는 알라딘 상품을 확인하지 못했습니다. 기존 재고를 유지합니다.", "ALADIN_ITEM_NOT_FOUND", 502);
}

async function usedOffers(itemId: string): Promise<AladinBranchStock[]> {
  const result: AladinBranchStock[] = [];
  const seen = new Set<string>();
  let snapshot: string | undefined;
  let privateCount = 0;
  for (let page = 1; page <= 100; page++) {
    const url = `https://www.aladin.co.kr/shop/UsedShop/wuseditemall.aspx?ItemId=${itemId}&TabType=0&Fix=1&page=${page}`;
    const current = parseUsedPage(await aladinHtml(url), itemId, 0, page);
    const signature = JSON.stringify([current.count, current.pages, current.totals]);
    if (snapshot != null && signature !== snapshot) changed("조회 중 알라딘 재고가 변경되었습니다. 기존 재고를 유지합니다.");
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
        changed("알라딘 중고 목록의 건수를 확인하지 못했습니다. 기존 재고를 유지합니다.");
      }
      return result;
    }
  }
  changed("알라딘 재고 페이지 한도를 초과했습니다. 기존 재고를 유지합니다.");
}

export async function lookupUsedStocks(isbnInput: string, sourceInput?: string): Promise<StockLookupResult> {
  const isbn = isbn13Schema.parse(isbnInput), source = usedSourceSchema.parse(sourceInput);
  try {
    const product = await exactProduct(isbn);
    if (!product.itemId) changed();
    const offers = await usedOffers(product.itemId);
    const stocks = offers.filter(stock => source === "all"
      || (source === "dropshipping" ? stock.branch === "ALADIN_DROPSHIPPING" : stock.branch !== "ALADIN_DROPSHIPPING"));
    return { successful: true, stocks, raw: { itemId: product.itemId, source }, partial: false };
  } catch (error) {
    return { successful: false, stocks: [], errorCode: error instanceof AppError ? error.code
      : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "ALADIN_TIMEOUT"
      : error instanceof TypeError ? "ALADIN_NETWORK_ERROR" : "ALADIN_LOOKUP_FAILED",
      errorMessage: error instanceof AppError ? error.message
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "알라딘 응답 시간이 초과되었습니다. 기존 재고를 유지합니다."
        : error instanceof TypeError ? "알라딘 서버에 연결하지 못했습니다. 기존 재고를 유지합니다." : "알라딘 재고 조회에 실패했습니다. 기존 재고를 유지합니다." };
  }
}
