import { SearchForm } from "@/components/ui/search-form";
import Link from "next/link";
import { requireUser } from "@/features/auth/authorization";
import { lookupUsedStocks } from "@/features/aladin/service";
import { isAladinConfigured } from "@/features/aladin/client";
import { formatWon } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ErrorReporter } from "@/components/ui/error-dialog";
import type { StockLookupResult } from "@/features/aladin/types";
import { ExternalLink } from "@/components/ui/external-link";

export const metadata = { title: "중고 재고 단건 조회" };
export default async function UsedSearchPage({ searchParams }: { searchParams: Promise<{ isbn?: string; isbn13?: string; type?: string }> }) {
  await requireUser();
  const query = await searchParams;
  const isbn = (query.isbn ?? query.isbn13)?.trim() ?? "";
  let result: StockLookupResult | null = null;
  if (isbn) {
    try { result = await lookupUsedStocks(isbn, query.type); }
    catch (error) { result = { successful: false, stocks: [], errorMessage: errorMessage(error, "재고 조회에 실패했습니다.") }; }
  }
  const prices = result?.stocks.map((stock) => stock.price?.replaceAll(",", "")).filter((value): value is string => Boolean(value && /^\d+$/.test(value))).map(Number) ?? [];
  const minimum = prices.length ? Math.min(...prices) : null;
  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">Used stock lookup</p><h1 className="page-title">ISBN 재고 조회</h1><p className="page-subtitle">알라딘 직배송과 지점별 중고 재고를 확인합니다.</p></div><Link className="button button-outline" href="/aladin/search">알라딘 검색</Link></header>
    {!isAladinConfigured() && <div className="flash flash-error">알라딘 검색이 설정되어 있지 않습니다.</div>}
    <section className="panel panel-soft"><SearchForm className="search-form" action="/aladin/used">
      <div className="field"><label htmlFor="isbn">ISBN10 또는 ISBN13</label><input className="input" id="isbn" name="isbn" pattern="([0-9]{13}|[0-9]{9}[0-9Xx])" defaultValue={isbn} required/></div>
      <div className="field"><label htmlFor="used-source">재고 종류</label><select className="select" id="used-source" name="type" defaultValue={query.type ?? "all"}>
        <option value="all">전체 중고 재고</option><option value="dropshipping">알라딘 직배송</option><option value="offstore">알라딘 지점 중고</option>
      </select></div><button className="button" type="submit">조회</button>
    </SearchForm></section>
    {result && (!result.successful ? <div className="flash flash-error" role="alert">{result.errorMessage}<ErrorReporter message={result.errorMessage} code="ALADIN_LOOKUP_FAILED" source="aladin-used"/></div> : <>
      {result.partial && <p className="flash flash-error" role="status">{result.warning}</p>}
      <section className="stack-md"><div className="section-heading"><h2>{result.partial ? "부분 확인 결과" : "조회 결과"}</h2><span className="chip">{result.stocks.length}건 · 최저 {minimum == null ? "가격 미상" : formatWon(minimum)}</span></div>
        {result.stocks.length ? <div className="inventory-grid">{result.stocks.map((stock, index) => <article className="branch-card" key={`${stock.branch}-${index}`}>
          <div className="section-heading"><h3>{stock.branchName}</h3>{stock.verified === false ? <span className="chip">상세 미확인</span> : stock.grade && <span className="chip">{stock.grade}</span>}</div>
          <p className="muted small">{stock.title}</p><p className="muted">{stock.price ? formatWon(stock.price) : "가격 미상"}</p>
          <div className="button-row"><ExternalLink className="button button-secondary button-small" href={stock.purchaseLink}>{stock.verified === false ? "지점 목록" : "구매 링크"}</ExternalLink><ExternalLink className="button button-outline button-small" href={stock.bookLink}>상품 링크</ExternalLink></div>
        </article>)}</div> : <div className="empty">현재 확인되는 중고 재고가 없습니다.</div>}
      </section>
      <details className="details-card"><summary>원본 JSON 응답</summary><pre className="details-body raw-response">{JSON.stringify(result.raw, null, 2)}</pre></details>
    </>)}
  </div>;
}
