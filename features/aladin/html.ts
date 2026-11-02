import { load } from "cheerio";
import { AppError } from "@/lib/errors";
import { asIsbn13, normalizedIsbn } from "@/features/aladin/item-key";
import type { AladinBookItem, AladinBranchStock, AladinSearchResult } from "@/features/aladin/types";

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const integer = (value: string) => Number(value.replaceAll(",", ""));
export function changed(message = "알라딘 페이지 구조를 확인하지 못했습니다. 기존 정보는 유지됩니다."): never {
  throw new AppError(message, "ALADIN_FORMAT_CHANGED", 502);
}
function page(html: string) {
  const $ = load(html);
  $("script,style,noscript").remove();
  return $;
}
function safeLink(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://www.aladin.co.kr");
    if (!["https:", "http:"].includes(url.protocol) || !["www.aladin.co.kr", "aladin.co.kr"].includes(url.hostname)
      || url.username || url.password || url.port) return null;
    url.protocol = "https:"; url.hash = "";
    return url.toString();
  } catch { return null; }
}
export function parseSearchPage(html: string, requestedPage: number): AladinSearchResult {
  const $ = page(html);
  const count = compact($("body").text()).match(/검색한 결과\s*총\s*([\d,]+)\s*건/);
  const pageSize = Number($("#Search3_Form [name=ViewRowCount]").val());
  if (!count || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) changed();
  const totalResults = integer(count[1]!);
  const selectedPage = Number($("a.numon").first().text().trim() || $("#Search3_Form [name=page]").val() || 1);
  if (selectedPage !== requestedPage && totalResults > 0) changed("알라딘 검색 페이지가 변경되었습니다. 다시 검색해 주세요.");
  const items: AladinBookItem[] = [];
  $(".ss_book_box[itemid]").each((_i, element) => {
    const box = $(element), itemId = box.attr("itemid") ?? "";
    const title = compact(box.find(".ss_book_list .bo3").first().text());
    if (!/^\d+$/.test(itemId) || !title) changed();
    const code = box.find("input[name^='chkCart.']").first().attr("name")?.slice(8);
    const isbn = normalizedIsbn(code);
    const metadata = box.find(".ss_book_list li").filter((_j, li) => /\d{4}년\s*\d{1,2}월/.test($(li).text())).first().text();
    const date = metadata.match(/(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?/);
    const author = compact(metadata.split("|")[0] ?? "") || null;
    const price = box.find(".ss_p2").first().text().match(/[\d,]+/);
    items.push({ itemId, title, author, description: null, isbn: isbn?.length === 10 ? isbn : null,
      isbn13: asIsbn13(isbn), cover: box.find("img.i_cover").first().attr("src") ?? null,
      priceSales: price ? integer(price[0]) : null, link: `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`,
      pubDate: date ? `${date[1]}-${date[2]!.padStart(2, "0")}${date[3] ? `-${date[3].padStart(2, "0")}` : ""}` : null,
      categoryName: null });
  });
  // A partially parsed page must not silently lose selected products.
  const expected = Math.min(pageSize, Math.max(0, totalResults - (requestedPage - 1) * pageSize));
  if (items.length !== expected || new Set(items.map(item => item.itemId)).size !== items.length) changed();
  return { items, totalResults, page: requestedPage, pageSize };
}

export function parseProductPage(html: string, itemId: string): AladinBookItem {
  const $ = page(html);
  const meta = (name: string) => $( `meta[property="og:${name}"]`).attr("content")?.trim() || null;
  const link = safeLink(meta("url") ?? undefined);
  const title = compact($(".Ere_bo_title").first().text()) || meta("title")?.split(" | ")[0] || "";
  if (!link || new URL(link).searchParams.get("ItemId") !== itemId || !title || !meta("site_name")) changed();
  const isbn = normalizedIsbn(meta("barcode"));
  const date = $(".Ere_sub2_title").text().match(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/)?.[0] ?? null;
  const categoryName = compact($("#ulCategory > li").first().text()).replace(/더보기|접기/g, "").trim() || null;
  return { itemId, title, author: meta("author"), description: meta("description"), isbn: isbn?.length === 10 ? isbn : null,
    isbn13: asIsbn13(isbn), cover: meta("image"), priceSales: /^\d+$/.test(meta("price") ?? "") ? Number(meta("price")) : null,
    link, pubDate: date, categoryName };
}

export function parseUsedPage(html: string, itemId: string, tab: 0 | 2 | 3, requestedPage: number) {
  const $ = page(html);
  const active = compact($("a.Ere_usedsell_tab_on").text());
  const total = active.match(/\(([\d,]+)\)/);
  if ($("input[name=ItemId]").val() !== itemId || Number($("input[name=TabType]").val()) !== tab
    || Number($("input[name=page]").val()) !== requestedPage || !total
    || !(tab === 0 ? /전체 중고/.test(active) : tab === 2 ? /알라딘 중고/.test(active) : /중고매장/.test(active))) changed();
  const count = integer(total[1]!);
  const stocks: AladinBranchStock[] = [];
  const offers: string[] = [];
  let privateCount = 0;
  const totals = { direct: 0, store: 0, private: 0 };
  if (tab === 0) {
    for (const [key, label] of [["direct", "알라딘 중고"], ["store", "중고매장"], ["private", "판매자 중고"]] as const) {
      const match = $("a[class*=Ere_usedsell_tab]").filter((_i, e) => $(e).text().includes(label)).text().match(/\(([\d,]+)\)/);
      if (!match) changed();
      totals[key] = integer(match[1]!);
    }
    if (totals.direct + totals.store + totals.private !== count) changed();
  }
  $(".Ere_usedsell_table tr:has(.sell_tableCF1)").each((_i, element) => {
    const row = $(element);
    const direct = row.find(".Ere_used_aladin").length > 0;
    const store = row.find(".Ere_store_name a").first();
    const sellerUrl = safeLink(store.attr("href") ?? row.find(".Ere_used_aladin a").attr("href"));
    const shop = sellerUrl ? new URL(sellerUrl).searchParams.get("SC") : null;
    const purchaseLink = safeLink(row.find(".info a[href*='wproduct.aspx?']").first().attr("href"));
    if (!purchaseLink || !/^\d+$/.test(new URL(purchaseLink).searchParams.get("ItemId") ?? "")) changed();
    offers.push(purchaseLink);
    if (tab === 0 && !direct && !store.length && !row.find(".Ere_used_store").length) {
      // Recognize marketplace badges, never infer seller type from a display name.
      if (!row.find(".seller .Ere_used_power, .seller .Ere_used_special, .seller .Ere_used_fresh, .seller .Ere_used_silver, .seller .Ere_used_gold").length) changed();
      privateCount++;
      return;
    }
    if (tab === 0 && (direct ? store.length > 0 || row.find(".Ere_used_store").length > 0
      : !row.find(".Ere_used_store").length || !shop || !/^\d+$/.test(shop))) changed();
    const price = row.find(".price .Ere_fs20").first().text().trim();
    const grade = compact(row.find(".Ere_sub_top").text());
    if ((tab === 2 && !direct) || (tab === 3 && (direct || !shop || !/^\d+$/.test(shop)))
      || !purchaseLink || !new URL(purchaseLink).searchParams.get("ItemId") || !/^[\d,]+$/.test(price) || !grade) changed();
    const branchName = direct ? "알라딘 직배송" : compact(store.text()).replace(/^중고매장\s*/, "");
    if (!branchName) changed();
    stocks.push({ branch: direct ? "ALADIN_DROPSHIPPING" : `ALADIN_STORE_${shop}`, branchName,
      price, grade, title: compact(row.find(".info a").first().text()), purchaseLink, bookLink: `https://www.aladin.co.kr/shop/UsedShop/wuseditemall.aspx?ItemId=${itemId}&TabType=${tab}&Fix=1`, verified: true });
  });
  if (!count && !/등록된 중고상품이 없습니다/.test($("body").text())) changed();
  if (count && !offers.length) changed();
  const pages = $(".Ere_usedsell_num_box .nright_text").text().match(/(\d+)\s*페이지/);
  const pageCount = pages ? Number(pages[1]) : 1;
  if (tab === 0 && (!pages || (count > 0 && (pageCount < requestedPage || offers.length > 20
    || (requestedPage < pageCount && offers.length !== 20))) || (!count && offers.length))) changed();
  return { stocks, count, pages: pageCount, offers, privateCount, totals };
}

export function parseStoreSearch(html: string, itemId: string, requestedPage: number) {
  const parsed = parseSearchPage(html, requestedPage);
  const $ = page(html);
  const branches: Array<{ branch: string; branchName: string; link: string }> = [];
  const box = $(".ss_book_box[itemid]").filter((_i, e) => $(e).attr("itemid") === itemId);
  if (parsed.items.length && !box.length) changed("ISBN에 해당하는 매장 상품을 확인하지 못했습니다.");
  box.find("a.usedshop_off_text3").each((_i, e) => {
    const link = safeLink($(e).attr("href"));
    const url = link ? new URL(link) : null;
    const branch = url?.searchParams.get("OffCode");
    const branchName = compact($(e).text());
    if (!link || !branch || !branchName || url?.searchParams.get("ItemId") !== itemId) changed();
    branches.push({ branch, branchName, link });
  });
  if (box.length && !branches.length) changed();
  return { branches, totalResults: parsed.totalResults, pageSize: parsed.pageSize };
}

export function parseBranchPage(html: string, branch: { branch: string; branchName: string; link: string }, title: string) {
  const $ = page(html);
  const total = $("span.ss_p4").first().text().match(/([\d,]+)\s*부/);
  if (!total) changed();
  const count = integer(total[1]!);
  let summed = 0;
  const stocks: AladinBranchStock[] = [];
  $("div.ss_book_box").each((_i, e) => {
    const box = $(e);
    const price = box.find("span.ss_p2 b").first().text().match(/([\d,]+)\s*원/);
    const quantity = box.find("span.ss_p4").first().text().match(/([\d,]+)\s*부/);
    const grade = compact(box.find("span.us_f_bob").first().text());
    if (!price || !quantity || !grade) changed();
    summed += integer(quantity[1]!);
    // The public store page groups copies by condition. Preserve one minimum per grade.
    stocks.push({ ...branch, title, price: price[1]!, grade, bookLink: branch.link, purchaseLink: branch.link, verified: true });
  });
  if (summed !== count || (count > 0 && !stocks.length)) changed();
  return stocks;
}
