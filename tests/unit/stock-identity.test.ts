import { describe, expect, it } from "vitest";
import { stockIdentity, uniqueStocks } from "@/features/inventory/stock-identity";
import type { AladinBranchStock } from "@/features/aladin/types";

const stock: AladinBranchStock = { branch: "SEOUL", branchName: "서울점", grade: "상", price: "4,000", title: "책",
  bookLink: "https://www.aladin.co.kr/list", purchaseLink: "https://www.aladin.co.kr/offer?id=1" };
describe("stock identity", () => {
  it("is stable across price, title, grade and display-name changes to the same offer", () => {
    expect(stockIdentity(1, stock)).toBe(stockIdentity(1, { ...stock, price: "9,000", title: "변경", grade: "최상", branchName: "서울" }));
  });
  it("separates products, owners' volumes and branches", () => {
    const key = stockIdentity(1, stock);
    expect(stockIdentity(1, { ...stock, purchaseLink: "https://www.aladin.co.kr/offer?id=2" })).not.toBe(key);
    expect(stockIdentity(2, stock)).not.toBe(key);
    expect(stockIdentity(1, { ...stock, branch: "BUSAN" })).not.toBe(key);
  });
  it("normalizes URL query order and fragments without dropping the product id", () => {
    expect(stockIdentity(1, { ...stock, purchaseLink: "https://www.aladin.co.kr/offer?a=2&id=1#top" }))
      .toBe(stockIdentity(1, { ...stock, purchaseLink: "https://www.aladin.co.kr/offer?id=1&a=2" }));
  });
  it("uses known minimum prices for summary duplicates and retains different grades", () => {
    const summary = { ...stock, purchaseLink: stock.bookLink };
    expect(uniqueStocks(1, [summary, { ...summary, price: "9,000" }, { ...summary, price: null }])).toEqual([summary]);
    expect(uniqueStocks(1, [{ ...summary, price: null }, summary])).toEqual([summary]);
    expect(uniqueStocks(1, [summary, { ...summary, grade: "중" }])).toHaveLength(2);
  });
});
