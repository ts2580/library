import { describe, expect, it } from "vitest";
import { stockPurchaseUrl } from "@/features/inventory/purchase-url";

describe("stock purchase links", () => {
  const product = "https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=offer";
  const listing = "https://www.aladin.co.kr/shop/UsedShop/wuseditemall.aspx?ItemId=book&OffCode=SEOUL";
  it("prefers the product offer to its branch listing", () => {
    expect(stockPurchaseUrl({ purchaseUrl: product, bookLink: listing })).toBe(product);
  });
  it.each([null, "", "   ", "javascript:alert(1)"])("uses the branch listing when the purchase URL is %s", purchaseUrl => {
    expect(stockPurchaseUrl({ purchaseUrl, bookLink: listing })).toBe(listing);
  });
  it("restores legacy Aladin root-relative links", () => {
    expect(stockPurchaseUrl({ purchaseUrl: "/shop/wproduct.aspx?ItemId=offer", bookLink: listing })).toBe(product);
    expect(stockPurchaseUrl({ purchaseUrl: null, bookLink: "/shop/UsedShop/wuseditemall.aspx?ItemId=book&OffCode=SEOUL" })).toBe(listing);
  });
  it("does not invent a link when both saved URLs are missing or invalid", () => {
    expect(stockPurchaseUrl({ purchaseUrl: null, bookLink: null })).toBeNull();
    expect(stockPurchaseUrl({ purchaseUrl: "data:text/html,unsafe", bookLink: "javascript:alert(1)" })).toBeNull();
    expect(stockPurchaseUrl({ purchaseUrl: "//untrusted.example/offer", bookLink: null })).toBeNull();
  });
});
