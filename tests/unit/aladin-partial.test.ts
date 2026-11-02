import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchPage, productPage, usedPage } from "../fixtures/aladin-pages.mjs";
vi.mock("server-only", () => ({}));
const html = vi.hoisted(() => vi.fn());
vi.mock("@/features/aladin/client", () => ({ aladinHtml: html }));
const isbn = "9780590353427";
const product = { itemId: "208556", isbn13: isbn, title: "책", author: "저자", pubDate: "1999-10-01" };
let service: typeof import("@/features/aladin/service");
beforeEach(async () => {
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
