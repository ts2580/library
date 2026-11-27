import { describe, expect, it } from "vitest";
import { stockIdentity, uniqueStocks } from "@/features/inventory/stock-identity";
import type { AladinBranchStock } from "@/features/aladin/types";

const stock: AladinBranchStock = { branch: "SEOUL", branchName: "서울점", grade: "상", price: "4,000", title: "책",
  bookLink: "https://www.aladin.co.kr/list", purchaseLink: "https://www.aladin.co.kr/offer?id=1" };
describe("stock identity", () => {
  it("is based on the parent book and normalized branch only", () => {
    expect(stockIdentity(1, stock)).toBe(stockIdentity(1, { ...stock, price: "9,000", title: "변경", grade: "최상", branchName: "서울" }));
    expect(stockIdentity(1, stock)).toBe(stockIdentity(1, { ...stock, branch: " SEOUL " }));
  });
  it("separates parent books and branches", () => {
    const key = stockIdentity(1, stock);
    expect(stockIdentity(2, stock)).not.toBe(key);
    expect(stockIdentity(1, { ...stock, branch: "BUSAN" })).not.toBe(key);
  });
  it("keeps the lowest known offer for each branch regardless of grade or purchase link", () => {
    const summary = { ...stock, purchaseLink: stock.bookLink };
    expect(uniqueStocks(1, [summary, { ...summary, price: "9,000" }, { ...summary, price: null }])).toEqual([summary]);
    expect(uniqueStocks(1, [{ ...summary, price: null }, summary])).toEqual([summary]);
    expect(uniqueStocks(1, [summary, { ...summary, grade: "중", purchaseLink: "https://www.aladin.co.kr/offer?id=2", price: "3,000" }]))
      .toEqual([{ ...summary, grade: "중", purchaseLink: "https://www.aladin.co.kr/offer?id=2", price: "3,000" }]);
  });
});
