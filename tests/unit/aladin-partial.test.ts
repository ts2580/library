import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ json: vi.fn(), html: vi.fn() }));
vi.mock("@/features/aladin/client", () => ({
  aladinJson: mocks.json, aladinHtml: mocks.html, isAladinConfigured: () => true,
  AladinRateLimitError: class AladinRateLimitError extends Error {}
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
const { lookupUsedStocks } = await import("@/features/aladin/service");
const { AladinRateLimitError } = await import("@/features/aladin/client");

beforeEach(() => {
  mocks.json.mockReset().mockImplementation(async (endpoint) => endpoint === "ItemLookUp.aspx"
    ? { item: [{ title: "책", subInfo: { usedList: { spaceUsed: { itemCount: 1, minPrice: 1000 } } } }] }
    : { itemOffStoreList: [{ offCode: "SEOUL", offName: "서울", link: "https://www.aladin.co.kr/branch/list" }] });
  mocks.html.mockReset();
});
describe("branch lookup quality", () => {
  it.each([0, undefined])("queries offline stores even when the lookup reports spaceUsed count %s", async itemCount => {
    mocks.json.mockImplementation(async endpoint => endpoint === "ItemLookUp.aspx"
      ? { item: [{ title: "책", subInfo: { usedList: { aladinUsed: { itemCount: 1, minPrice: 2000 }, spaceUsed: { itemCount } } } }] }
      : { itemOffStoreList: [{ offCode: "SEOUL", offName: "서울", link: "https://www.aladin.co.kr/branch/list" }] });
    mocks.html.mockResolvedValue('<div class="ss_book_box"><span class="ss_p2"><b>1,000</b></span><span class="us_f_bob">상</span><a href="/shop/UsedShop/wuseditemall.aspx?ItemId=1">상품</a></div>');
    const result = await lookupUsedStocks("9780000000001");
    expect(result).toMatchObject({ successful: true, partial: false });
    expect(result.stocks.map(stock => stock.branch)).toEqual(["ALADIN_DROPSHIPPING", "SEOUL"]);
    expect(mocks.json).toHaveBeenCalledWith("ItemOffStoreList.aspx", expect.anything());
  });
  it("queries offline stores even when item lookup has no matching item", async () => {
    mocks.json.mockImplementation(async endpoint => endpoint === "ItemLookUp.aspx"
      ? { item: [] }
      : { itemOffStoreList: [{ offCode: "SEOUL", offName: "서울", link: "https://www.aladin.co.kr/branch/list" }] });
    mocks.html.mockResolvedValue('<div class="ss_book_box"><span class="ss_p2"><b>1,000</b></span><span class="us_f_bob">상</span></div>');
    expect(await lookupUsedStocks("9780000000001")).toMatchObject({ successful: true, partial: false, stocks: [{ branch: "SEOUL", price: "1,000" }] });
  });
  it("propagates HTML rate limiting to the job stop policy", async () => {
    mocks.html.mockRejectedValue(new AladinRateLimitError());
    expect(await lookupUsedStocks("9780000000001")).toMatchObject({ successful: false, stocks: [], errorMessage: expect.stringContaining("429") });
  });
  it.each(["network", "unrecognized markup"])("does not assign another branch's minimum after %s", async (kind) => {
    if (kind === "network") mocks.html.mockRejectedValue(new Error("offline"));
    else mocks.html.mockResolvedValue("<html><p>changed markup</p></html>");
    expect(await lookupUsedStocks("9780000000001")).toMatchObject({ successful: true, partial: true,
      stocks: [{ branch: "SEOUL", price: null, verified: false }] });
  });
  it("retains independently parsed same-grade products", async () => {
    mocks.html.mockResolvedValue([1, 2].map((id) => `<div class="ss_book_box"><span class="ss_p2"><b>${id * 4000}</b></span><span class="us_f_bob">상</span><a href="/shop/UsedShop/wuseditemall.aspx?ItemId=${id}">상품</a></div>`).join(""));
    const result = await lookupUsedStocks("9780000000001");
    expect(result).toMatchObject({ successful: true, partial: false });
    expect(result.stocks).toHaveLength(2);
    expect(result.stocks[0]?.purchaseLink).not.toBe(result.stocks[1]?.purchaseLink);
  });
});
