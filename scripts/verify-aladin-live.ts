/** Opt-in, bounded, read-only verification of the public Aladin adapter.
 * BOOKSHELF_DATA_DIR must be a dedicated /tmp/bookshelf-aladin-live-* directory.
 * Never loaded by the normal app or automated fixture test suite. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { env } from "@/lib/env";
import { searchAladinBooks, getAladinProduct, lookupUsedStocks } from "@/features/aladin/service";

async function main() {
  assert(path.dirname(env.dataDir) === tmpdir() && path.basename(env.dataDir).startsWith("bookshelf-aladin-live-"), "Use an isolated temporary data directory");
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    assert(++requests <= 40, "Live verification request budget exceeded");
    return original(input, init);
  };
  const checks: Array<Record<string, unknown>> = [];
  try {
    const zero = await lookupUsedStocks("9780590353427", "dropshipping");
    assert(zero.successful, zero.successful ? undefined : zero.errorMessage);
    checks.push({ name: "stock:previous-zero-case", isbn: "9780590353427", count: zero.stocks.length, requests });
    for (const searchTarget of ["Book", "Foreign", "Music", "DVD", "Used", "eBook", "All"]) {
      const result = await searchAladinBooks({ query: "해리 포터", queryType: "Keyword", searchTarget, maxResults: 10 });
      checks.push({ name: `target:${searchTarget}`, total: result.totalResults, count: result.items.length, pageSize: result.pageSize });
    }
    for (const [queryType, query] of [["Title", "해리 포터"], ["Author", "한강"], ["Publisher", "문학수첩"]]) {
      const result = await searchAladinBooks({ query, queryType, sort: "SalesPoint", categoryId: 1, recentPublishFilter: 3, outOfStockFilter: true, maxResults: 10 });
      checks.push({ name: `field:${queryType}`, total: result.totalResults, count: result.items.length });
    }
    const first = await searchAladinBooks({ query: "해리 포터", page: 1, maxResults: 10 });
    const second = await searchAladinBooks({ query: "해리 포터", page: 2, maxResults: 10 });
    assert.notEqual(first.items[0]?.itemId, second.items[0]?.itemId);
    checks.push({ name: "pagination", pages: [first.page, second.page], total: second.totalResults });
    const empty = await searchAladinBooks({ query: "qqzbookshelfunknown9918273" });
    assert.equal(empty.totalResults, 0); checks.push({ name: "empty", total: 0 });
    const isbn10 = await searchAladinBooks({ query: "059035342X", queryType: "Keyword", searchTarget: "All" });
    assert.equal(isbn10.items[0]?.isbn13, "9780590353427");
    const product = await getAladinProduct("208556");
    assert.equal(product.isbn13, "9780590353427"); assert(product.description); assert(product.cover?.includes("cover500"));
    checks.push({ name: "product", isbn13: product.isbn13, itemId: product.itemId, pubDate: product.pubDate, hasSummary: Boolean(product.description) });
    for (const [isbn, source] of [["9788936434120", "dropshipping"], ["9780590353403", "offstore"]]) {
      const result = await lookupUsedStocks(isbn!, source);
      assert(result.successful, result.successful ? undefined : result.errorMessage);
      checks.push({ name: `stock:${source}`, isbn, count: result.stocks.length,
        offers: result.stocks.map(s => ({ branch: s.branch, grade: s.grade, price: s.price })) });
    }
    fs.mkdirSync("test-results", { recursive: true });
    const report = { passed: true, checkedAt: new Date().toISOString(), requests, checks };
    fs.writeFileSync("test-results/aladin-live.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ passed: false, requests, checks, firstFailure: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  } finally { globalThis.fetch = original; }
}
void main();
