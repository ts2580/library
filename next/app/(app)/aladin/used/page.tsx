import { SearchForm } from "@/components/ui/search-form";
import Link from "next/link";
import { requireUser } from "@/features/auth/authorization";
import { lookupUsedStocks } from "@/features/aladin/service";
import { isAladinConfigured } from "@/features/aladin/client";
import { formatWon } from "@/lib/format";
import { ExternalLink } from "@/components/ui/external-link";

export const metadata = { title: "중고 재고 단건 조회" };
export default async function UsedSearchPage({ searchParams }: { searchParams: Promise<{ isbn?: string }> }) {
  await requireUser();
  const query = await searchParams;
  const isbn = query.isbn?.trim() ?? "";
  const result = isbn ? await lookupUsedStocks(isbn) : null;
  return <div className="page"><header className="page-header"><div><p className="eyebrow">Used stock lookup</p><h1 className="page-title">ISBN 재고 조회</h1><p className="page-subtitle">DB를 변경하지 않고 알라딘 중고 재고를 단건 확인합니다.</p></div><Link className="button button-outline" href="/inventory">재고 대시보드</Link></header>{!isAladinConfigured() && <div className="flash flash-error">ALADIN_TTB_KEY가 설정되어 있지 않습니다.</div>}<section className="panel panel-soft"><SearchForm className="search-form" action="/aladin/used"><div className="field"><label htmlFor="isbn">ISBN10 또는 ISBN13</label><input className="input" id="isbn" name="isbn" inputMode="numeric" pattern="[0-9]{10,13}" defaultValue={isbn} required/></div><button className="button" type="submit">조회</button></SearchForm></section>{result && (!result.successful ? <div className="flash flash-error" role="alert">{result.errorMessage}</div> : <section className="stack-md"><div className="section-heading"><h2>조회 결과</h2><span className="chip">{result.stocks.length}건</span></div>{result.stocks.length ? <div className="inventory-grid">{result.stocks.map((stock, index) => <article className="branch-card" key={`${stock.branch}-${index}`}><div className="section-heading"><h3>{stock.branchName}</h3>{stock.grade && <span className="chip">{stock.grade}</span>}</div><p className="muted">{stock.price ? formatWon(stock.price) : "가격 미상"}</p><div className="button-row"><ExternalLink className="button button-secondary button-small" href={stock.purchaseLink}>구매 링크</ExternalLink><ExternalLink className="button button-outline button-small" href={stock.bookLink}>상품 링크</ExternalLink></div></article>)}</div> : <div className="empty">현재 확인되는 중고 재고가 없습니다.</div>}</section>)}</div>;
}
