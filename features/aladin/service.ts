import "server-only";
import { load } from "cheerio";
import { AladinRateLimitError, aladinHtml, aladinJson, isAladinConfigured } from "@/features/aladin/client";
import type { AladinBookItem, AladinBranchStock, AladinSearchResult, StockLookupResult } from "@/features/aladin/types";
import { aladinSearchSchema, isbn13Schema, usedSourceSchema } from "@/features/aladin/validation";
import { largeAladinCover } from "@/features/aladin/cover-url";
import { logger } from "@/lib/logger";

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}


function absoluteAladinUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.aladin.co.kr");
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:" || !["aladin.co.kr", "www.aladin.co.kr"].includes(url.hostname.toLowerCase())) return null;
    if (url.username || url.password || (url.port && url.port !== "443")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function branchStocks(input: {
  branch: string;
  branchName: string;
  branchLink: string | null;
  title: string | null;
}): Promise<{ stocks: AladinBranchStock[]; partial: boolean }> {
  const fallback: AladinBranchStock = {
    verified: false,
    branch: input.branch,
    branchName: input.branchName,
    grade: null,
    bookLink: input.branchLink,
    purchaseLink: input.branchLink,
    price: null,
    title: input.title
  };
  if (!input.branchLink) return { stocks: [fallback], partial: true };
  try {
    const html = await aladinHtml(input.branchLink);
    const $ = load(html);
    const parsed: AladinBranchStock[] = [];
    const boxes = $("div.ss_book_box");
    if (boxes.length > 0) {
      boxes.each((_index, element) => {
        const box = $(element);
        const price = box.find("span.ss_p2 b").first().text().replace(/[^0-9,]/g, "").trim();
        const grade = box.find("span.us_f_bob").first().text().trim();
        if (!price || !grade) return;
        const href = box.find("a[href*='/shop/UsedShop/wuseditemall.aspx?']").first().attr("href") ?? null;
        parsed.push({
          branch: input.branch,
          branchName: input.branchName,
          grade,
          bookLink: input.branchLink,
          purchaseLink: absoluteAladinUrl(href),
          price,
          title: input.title
        });
      });
    } else {
      const prices = $("span.ss_p2 b");
      const grades = $("span.us_f_bob");
      const links = $("a[href*='/shop/UsedShop/wuseditemall.aspx?']");
      const size = Math.min(prices.length, grades.length);
      for (let index = 0; index < size; index += 1) {
        const price = prices.eq(index).text().replace(/[^0-9,]/g, "").trim();
        const grade = grades.eq(index).text().trim();
        if (!price || !grade) continue;
        parsed.push({
          branch: input.branch,
          branchName: input.branchName,
          grade,
          bookLink: input.branchLink,
          purchaseLink: absoluteAladinUrl(links.eq(index).attr("href") ?? null),
          price,
          title: input.title
        });
      }
    }
    return parsed.length ? { stocks: parsed, partial: false } : { stocks: [fallback], partial: true };
  } catch (error) {
    // A rate limit must reach the lookup/job retry and stop policy.
    if (error instanceof AladinRateLimitError) throw error;
    logger.warn("Branch inventory detail could not be verified", { branch: input.branch });
    return { stocks: [fallback], partial: true };
  }
}

export async function searchAladinBooks(input: unknown): Promise<AladinSearchResult> {
  const { query, page, ...options } = aladinSearchSchema.parse(input);
  if (!isAladinConfigured()) return { items: [], totalResults: 0, page, pageSize: options.maxResults };
  const raw = object(await aladinJson("ItemSearch.aspx", {
    Query: query,
    QueryType: options.queryType,
    MaxResults: options.maxResults,
    start: page,
    Cover: options.cover,
    SearchTarget: options.searchTarget,
    Sort: options.sort,
    CategoryId: options.categoryId,
    RecentPublishFilter: options.recentPublishFilter,
    outofStockfilter: options.outOfStockFilter
  })) ?? {};
  const items = array(raw.item).map(object).filter((item): item is Record<string, unknown> => Boolean(item)).map((item): AladinBookItem => ({
    title: text(item.title) ?? "제목 없음",
    author: text(item.author),
    description: text(item.description),
    isbn: text(item.isbn),
    isbn13: text(item.isbn13),
    cover: largeAladinCover(text(item.cover)),
    priceSales: number(item.priceSales),
    link: text(item.link),
    pubDate: text(item.pubDate),
    categoryName: text(item.categoryName)
  }));
  return {
    items,
    totalResults: number(raw.totalResults) ?? items.length,
    page: number(raw.startIndex) ?? page,
    pageSize: number(raw.itemsPerPage) ?? options.maxResults
  };
}

export async function lookupUsedStocks(isbnInput: string, sourceInput?: string): Promise<StockLookupResult> {
  const isbn13 = isbn13Schema.parse(isbnInput);
  const source = usedSourceSchema.parse(sourceInput);
  if (!isAladinConfigured()) return { successful: false, stocks: [], errorMessage: "알라딘 API 키가 없습니다." };
  try {
    const lookupRaw = await aladinJson("ItemLookUp.aspx", {
      ItemId: isbn13,
      itemIdType: isbn13.length === 10 ? "ISBN" : "ISBN13",
      Cover: "Big",
      OptResult: "usedList"
    });
    const lookup = object(lookupRaw) ?? {};
    const first = object(array(lookup.item)[0]);
    if (!first && source !== "offstore") return { successful: true, stocks: [], raw: lookupRaw };
    const subInfo = object(first?.subInfo);
    const usedList = object(subInfo?.usedList);
    const aladinUsed = object(usedList?.aladinUsed);
    const spaceUsed = object(usedList?.spaceUsed);
    const title = text(first?.title);
    const stocks: AladinBranchStock[] = [];
    let raw = lookupRaw;
    let partial = false;

    if (source !== "offstore" && (number(aladinUsed?.itemCount) ?? 0) > 0) {
      const link = text(aladinUsed?.link)?.replaceAll("amp;", "") ?? null;
      stocks.push({
        branch: "ALADIN_DROPSHIPPING",
        branchName: "알라딘 직배송",
        grade: null,
        bookLink: link,
        purchaseLink: link,
        price: number(aladinUsed?.minPrice)?.toString() ?? null,
        title
      });
    }

    if (source === "offstore" || (source === "all" && (number(spaceUsed?.itemCount) ?? 0) > 0)) {
      const offRaw = await aladinJson("ItemOffStoreList.aspx", {
        ItemId: isbn13,
        itemIdType: isbn13.length === 10 ? "ISBN" : "ISBN13",
        Cover: "Big"
      });
      const off = object(offRaw) ?? {};
      raw = source === "offstore" ? offRaw : { lookup: lookupRaw, offStores: offRaw };
      const branches = array(off.itemOffStoreList).map(object).filter((item): item is Record<string, unknown> => Boolean(item));
      for (const branch of branches) {
        const link = absoluteAladinUrl(text(branch.link)?.replaceAll("amp;", "") ?? null);
        const branchCode = text(branch.offCode) ?? text(branch.offName) ?? "UNKNOWN";
        const branchName = text(branch.offName) ?? text(branch.offCode) ?? "지점";
        const detail = await branchStocks({
          branch: branchCode,
          branchName,
          branchLink: link,
          title
        });
        partial ||= detail.partial;
        stocks.push(...detail.stocks);
      }
    }

    return { successful: true, stocks, raw, partial,
      warning: partial ? "일부 지점의 상세 재고를 확인하지 못했습니다. 해당 지점의 가격은 미확인이며, 이 권의 조회 결과는 일괄 재고 저장에서 제외됩니다." : undefined };
  } catch (error) {
    const rateLimited = error instanceof AladinRateLimitError;
    logger.warn("Aladin used stock lookup failed", {
      isbn13,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      successful: false,
      stocks: [],
      errorMessage: rateLimited
        ? "알라딘 API 호출 제한(429)으로 조회하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : "알라딘 중고 재고 조회에 실패했습니다."
    };
  }
}
