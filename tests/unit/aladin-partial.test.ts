import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { searchPage, productPage, usedPage } from "../fixtures/aladin-pages.mjs";
vi.mock("server-only", () => ({}));
const html = vi.hoisted(() => vi.fn());
vi.mock("@/features/aladin/client", () => ({ aladinHtml: html }));
const isbn = "9780590353427";
const product = { itemId: "208556", isbn13: isbn, title: "책", author: "저자", pubDate: "1999-10-01" };
let service: typeof import("@/features/aladin/service");
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-inventory-product-"));
vi.stubEnv("BOOKSHELF_DATA_DIR", directory);
vi.stubEnv("BOOKSHELF_DB_PATH", path.join(directory, "catalog.sqlite"));
const { sqlite } = await import("@/db");
afterAll(() => {
  sqlite.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  sqlite.exec("DELETE FROM aladin_inventory_product");
  vi.resetModules(); service = await import("@/features/aladin/service");
  html.mockReset().mockImplementation(async (raw: string) => {
    const url = new URL(raw);
    if (url.pathname.includes("wsearchresult")) return searchPage([product], { stores: url.searchParams.get("SearchTarget") === "UsedStore" });
    if (url.pathname.includes("wuseditemall")) return usedPage(product.itemId);
    return productPage(product);
  });
});
describe("HTML inventory contract", () => {
  it.each(["all", "offstore", "dropshipping"])("looks up an exact ISBN and isolates %s sources", async source => {
    const result = await service.lookupUsedStocks(isbn, source);
    expect(result.successful).toBe(true);
    expect(result.stocks.map(s => s.branch)).toEqual(source === "all" ? ["ALADIN_DROPSHIPPING", "ALADIN_STORE_123"] : [source === "offstore" ? "ALADIN_STORE_123" : "ALADIN_DROPSHIPPING"]);
  });
  it("reduces inventory HTTP reads from three to two with a verified link, then to one fresh stock read", async () => {
    const link = `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${product.itemId}`;
    await service.lookupUsedStocks(isbn);
    expect(html).toHaveBeenCalledTimes(3);
    html.mockClear();
    expect((await service.lookupUsedStocks(isbn, undefined, "inventory", link)).successful).toBe(true);
    expect(html.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/shop/wproduct.aspx","/shop/UsedShop/wuseditemall.aspx"]);
    expect(html.mock.calls.every(([,group]) => group === "inventory")).toBe(true);
    html.mockClear();
    await service.lookupUsedStocks(isbn, undefined, "inventory");
    expect(html.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/shop/UsedShop/wuseditemall.aspx"]);
  });
  it("reads only fresh offers after a restart even for a year-old product mapping", async () => {
    await service.lookupUsedStocks(isbn, undefined, "inventory");
    sqlite.prepare("UPDATE aladin_inventory_product SET verified_at=?").run(Date.now() - 365 * 86_400_000);
    vi.resetModules();
    service = await import("@/features/aladin/service");
    html.mockClear().mockResolvedValue(usedPage(product.itemId, { offers: [{ kind: "private" }] }));
    expect(await service.lookupUsedStocks(isbn, undefined, "inventory")).toMatchObject({ successful: true, stocks: [] });
    expect(html.mock.calls.map(([raw]) => new URL(raw).pathname)).toEqual(["/shop/UsedShop/wuseditemall.aspx"]);
  });
  it("recovers when a cached listing returns a different product ID", async () => {
    sqlite.prepare("INSERT INTO aladin_inventory_product VALUES(?,?,?)").run(isbn, "111", 0);
    const original = html.getMockImplementation()!;
    html.mockImplementation(raw => new URL(raw).searchParams.get("ItemId") === "111"
      ? usedPage("222") : original(raw));
    expect(await service.lookupUsedStocks(isbn, undefined, "inventory")).toMatchObject({ successful: true });
    expect(sqlite.prepare("SELECT item_id FROM aladin_inventory_product WHERE isbn=?").get(isbn)).toEqual({ item_id: product.itemId });
  });
  it("rediscovers a removed listing once and does not invalidate a verified mapping on timeout", async () => {
    const { AppError } = await import("@/lib/errors");
    sqlite.prepare("INSERT INTO aladin_inventory_product VALUES(?,?,?)").run(isbn, "111", Date.now());
    const original = html.getMockImplementation()!;
    html.mockImplementation(raw => {
      if (new URL(raw).searchParams.get("ItemId") === "111") throw new AppError("HTTP 404", "ALADIN_HTTP_ERROR", 502);
      return original(raw);
    });
    expect(await service.lookupUsedStocks(isbn, undefined, "inventory")).toMatchObject({ successful: true, raw: { itemId: product.itemId } });
    expect(html.mock.calls.map(([raw]) => new URL(raw).pathname)).toEqual([
      "/shop/UsedShop/wuseditemall.aspx", "/search/wsearchresult.aspx", "/shop/wproduct.aspx", "/shop/UsedShop/wuseditemall.aspx"
    ]);
    html.mockClear().mockRejectedValue(new TypeError("offline"));
    expect(await service.lookupUsedStocks(isbn, undefined, "inventory")).toMatchObject({ successful: false, errorCode: "ALADIN_NETWORK_ERROR" });
    expect(html).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT item_id FROM aladin_inventory_product WHERE isbn=?").get(isbn)).toEqual({ item_id: product.itemId });
  });
  it("falls back to an ISBN search when a saved product link points to another edition", async () => {
    const original = html.getMockImplementation()!;
    html.mockImplementation((raw, group) => String(raw).includes("ItemId=111")
      ? productPage({...product,itemId:"111",isbn13:"9780590353403"}) : original(raw, group));
    const result = await service.lookupUsedStocks(isbn, undefined, "inventory", "https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=111");
    expect(result).toMatchObject({successful:true, raw:{itemId:product.itemId}});
    expect(html.mock.calls.map(([raw]) => new URL(raw).pathname)).toEqual([
      "/shop/wproduct.aspx","/search/wsearchresult.aspx","/shop/wproduct.aspx","/shop/UsedShop/wuseditemall.aspx"
    ]);
  });
  it("searches the original ISBN publicly when an unverified saved link requires login", async () => {
    const original = html.getMockImplementation()!;
    html.mockImplementation(raw => new URL(raw).searchParams.get("ItemId") === "111"
      ? "<script>if(confirm('19세 이상만 이용할 수 있는 상품'))location.href='/login/wlogin.aspx?isAdult=1'</script>"
      : original(raw));
    const result = await service.lookupUsedStocks(isbn, undefined, "inventory", "https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=111");
    expect(result).toMatchObject({ successful: true, raw: { itemId: product.itemId } });
    expect(new URL(html.mock.calls[1]![0]).searchParams.get("SearchWord")).toBe(isbn);
  });
  it("uses ISBN10 as a search keyword and verifies the canonical ISBN13", async () => {
    expect((await service.lookupUsedStocks("059035342X", "dropshipping")).successful).toBe(true);
    expect(new URL(html.mock.calls[0]![0]).searchParams.get("SearchWord")).toBe("059035342X");
  });
  it.each(["12345678901", "123456789012"])("rejects invalid identifier %s", async isbn => {
    await expect(service.lookupUsedStocks(isbn)).rejects.toThrow(); expect(html).not.toHaveBeenCalled();
  });
  it("distinguishes a missing product from confirmed zero stock", async () => {
    html.mockResolvedValue(searchPage([], { total: 0 }));
    expect(await service.lookupUsedStocks(isbn)).toMatchObject({ successful: false, errorCode: "ALADIN_ITEM_NOT_FOUND" });
  });
  it("reports the adult login prompt on product and offer pages", async () => {
    const original = html.getMockImplementation()!;
    const prompt = "<script>if(confirm('19세 이상만 이용할 수 있는 상품입니다. 로그인해주세요.')){document.location.href='/login/wlogin.aspx?isAdult=1'}</script>";
    for (const path of ["/shop/wproduct.aspx", "/shop/UsedShop/wuseditemall.aspx"]) {
      html.mockImplementation(raw => new URL(raw).pathname === path ? prompt : original(raw));
      expect(await service.lookupUsedStocks(isbn)).toMatchObject({ successful:false, errorCode:"ALADIN_ADULT_LOGIN_REQUIRED" });
    }
  });
  it("reports an invalid ISBN check digit when there are no catalog matches", async () => {
    html.mockResolvedValue(searchPage([], { total: 0 }));
    expect(await service.lookupUsedStocks("9791169478331")).toMatchObject({ successful:false, errorCode:"ISBN_INVALID" });
  });
  it("checks the published product barcode when a derived ISBN13 differs in its last digit", async () => {
    const wanted = "9788989571146";
    html.mockImplementation(raw => {
      const url = new URL(raw);
      if (url.pathname.includes("wsearchresult")) return searchPage([{...product,isbn13:"8989571146"}]);
      if (url.pathname.includes("wproduct")) return productPage({...product,isbn13:wanted});
      return usedPage(product.itemId);
    });
    expect(await service.lookupUsedStocks(wanted)).toMatchObject({ successful:true, raw:{itemId:product.itemId} });
    expect(await service.lookupUsedStocks("9788989571147")).toMatchObject({ successful:false, errorCode:"ALADIN_ITEM_NOT_FOUND" });
  });
  it.each([0, 1])("stops after one explicit empty direct-shipping page with %i total pages", async pages => {
    const original = html.getMockImplementation()!;
    html.mockImplementation(raw => String(raw).includes('wuseditemall') ? usedPage(product.itemId, {count:0, pages, offers:[]}) : original(raw));
    expect(await service.lookupUsedStocks(isbn, "dropshipping")).toMatchObject({ successful:true, stocks:[] });
    expect(html.mock.calls.filter(([url]) => String(url).includes('wuseditemall'))).toHaveLength(1);
  });
  it.each(["<html>maintenance</html>", "<error><errorCode>999</errorCode></error>"])("fails closed on non-result markup", async body => {
    html.mockResolvedValue(body);
    expect(await service.lookupUsedStocks(isbn)).toMatchObject({ successful:false,stocks:[],errorCode:"ALADIN_FORMAT_CHANGED" });
  });
  it("does not publish a partial result when a later page is unavailable", async () => {
    const original = html.getMockImplementation()!;
    html.mockImplementation(raw => {
      const url = new URL(raw);
      if (!url.pathname.includes('wuseditemall')) return original(raw);
      if (url.searchParams.get('page') === '2') throw new TypeError('offline');
      return usedPage(product.itemId, {count:21,pages:2,offers:Array.from({length:20},()=>({kind:'direct'})),totals:{direct:21,store:0,private:0}});
    });
    expect(await service.lookupUsedStocks(isbn)).toMatchObject({ successful:false,stocks:[],errorCode:"ALADIN_NETWORK_ERROR" });
  });
  it("rejects an edition mismatch", async () => {
    const original = html.getMockImplementation()!;
    html.mockImplementation(raw => String(raw).includes('/shop/wproduct') ? productPage({...product,isbn13:'9780590353403'}) : original(raw));
    expect(await service.lookupUsedStocks(isbn)).toMatchObject({ successful:false,errorCode:"ALADIN_ITEM_NOT_FOUND" });
  });
  it("reads past a private-seller-only first page and filters only after pagination", async () => {
    const original = html.getMockImplementation()!;
    html.mockImplementation(raw => {
      const url = new URL(raw);
      if (!url.pathname.includes('wuseditemall')) return original(raw);
      expect(url.searchParams.get('TabType')).toBe('0');
      const page=Number(url.searchParams.get('page'));
      return usedPage(product.itemId,{count:23,page,pages:2,totals:{direct:2,store:1,private:20},
        offers:page===1?Array.from({length:20},()=>({kind:'private'})):[{kind:'direct'},{kind:'direct'},{kind:'store'}]});
    });
    const result=await service.lookupUsedStocks(isbn);
    expect(result.successful).toBe(true);expect(result.stocks).toHaveLength(3);
    expect(new Set(result.stocks.map(s=>s.purchaseLink)).size).toBe(3);
    expect(html).toHaveBeenCalledTimes(4); // ISBN search + detail + two used pages, no branch requests.
  });
  it.each(['duplicate','short','changed','missing-private','missing-direct'])("rejects %s inventory pages", async failure => {
    const original=html.getMockImplementation()!;
    html.mockImplementation(raw=>{
      const url=new URL(raw);
      if(!url.pathname.includes('wuseditemall')) return original(raw);
      const page=Number(url.searchParams.get('page'));
      if(failure==='missing-private') return usedPage(product.itemId,{count:3,totals:{direct:1,store:1,private:1}});
      if(failure==='missing-direct') return usedPage(product.itemId,{count:3,totals:{direct:2,store:1,private:0}});
      return usedPage(product.itemId,{count:page===2&&failure==='changed'?22:21,page,pages:2,
        totals:{direct:page===2&&failure==='changed'?22:21,store:0,private:0},
        offers:page===1?Array.from({length:failure==='short'?19:20},()=>({kind:'direct'})):[{kind:'direct',id:`${product.itemId}10`}]});
    });
    expect(await service.lookupUsedStocks(isbn)).toMatchObject({successful:false,errorCode:'ALADIN_FORMAT_CHANGED'});
  });
  it("returns confirmed zero eligible stock when every offer is private", async()=>{
    const original=html.getMockImplementation()!;
    html.mockImplementation(raw=>String(raw).includes('wuseditemall')?usedPage(product.itemId,{offers:[{kind:'private'}]}):original(raw));
    expect(await service.lookupUsedStocks(isbn)).toMatchObject({successful:true,stocks:[]});
  });
  it("accepts more store copies in the tab than separately listed online offers", async()=>{
    const original=html.getMockImplementation()!;
    html.mockImplementation(raw=>String(raw).includes('wuseditemall')?usedPage(product.itemId,{count:4,totals:{direct:1,store:3,private:0}}):original(raw));
    expect(await service.lookupUsedStocks(isbn)).toMatchObject({successful:true,stocks:expect.any(Array)});
  });
});
