// Loaded only by the isolated E2E server, never by normal web/worker commands.
import { createHash } from "node:crypto";
const originalFetch = globalThis.fetch;
globalThis.fetch = async function fixtureFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "www.aladin.co.kr") return originalFetch(input, init);
  if (url.pathname.endsWith("ItemSearch.aspx")) {
    if (url.searchParams.get("Query")?.startsWith("검색결과없음")) return Response.json({ totalResults: 0, item: [] });
    const page = Number(url.searchParams.get("start") ?? 1);
    const namespace = String(parseInt(createHash("sha256").update(url.searchParams.get("Query") ?? "").digest("hex").slice(0, 8), 16) % 1000000).padStart(6, "0");
    return Response.json({ totalResults: 40, startIndex: page, itemsPerPage: 20, item: [1, 2].map((index) => ({
      title: `선택 샘플 ${page}-${index}`, isbn13: `978${namespace}${String(page * 10 + index).padStart(4, "0")}`,
      author: "테스트 저자", description: "fixture", priceSales: 1000,
      pubDate: new Date(Date.UTC(2025, 0, 1) - (page * 20 + index) * 86400000).toISOString().slice(0, 10)
    })) });
  }
  if (url.pathname.endsWith("ItemLookUp.aspx")) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return Response.json({ item: [{ title: "갱신된 테스트 재고", subInfo: { usedList: {
      aladinUsed: { itemCount: 1, minPrice: 2300, link: "https://www.aladin.co.kr/shop/test" },
      spaceUsed: { itemCount: 1, minPrice: 1700 }
    } } }] });
  }
  if (url.pathname.endsWith("ItemOffStoreList.aspx")) return Response.json({ itemOffStoreList: [{ offCode: "SEOUL", offName: "갱신 서울점", link: "/shop/usedshop/test" }] });
  if (url.pathname === "/shop/usedshop/test") return new Response(`<div class="ss_book_box"><span class="ss_p2"><b>1,700</b></span><span class="us_f_bob">상</span><a href="/shop/UsedShop/wuseditemall.aspx?ItemId=fixture">구매</a></div>`, { headers: { "content-type": "text/html" } });
  throw new Error("Unexpected Aladin request in isolated E2E fixture");
};
