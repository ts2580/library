// Loaded only by the isolated E2E server, never by normal web/worker commands.
const originalFetch = globalThis.fetch;
globalThis.fetch = async function fixtureFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "www.aladin.co.kr") return originalFetch(input, init);
  if (url.pathname.endsWith("ItemSearch.aspx")) {
    const page = Number(url.searchParams.get("start") ?? 1);
    return Response.json({ totalResults: 40, startIndex: page, itemsPerPage: 20, item: [1, 2].map((index) => ({
      title: `선택 샘플 ${page}-${index}`, isbn13: `978000000${String(page * 10 + index).padStart(4, "0")}`,
      author: "테스트 저자", description: "fixture", priceSales: 1000
    })) });
  }
  if (url.pathname.endsWith("ItemLookUp.aspx")) return Response.json({ item: [] });
  throw new Error("Unexpected Aladin request in isolated E2E fixture");
};
