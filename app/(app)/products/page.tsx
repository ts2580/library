import { SearchForm } from "@/components/ui/search-form";
import { Pagination } from "@/components/ui/pagination";
import Link from "next/link";
import { BookDetailLink } from "@/components/books/book-detail-link";
import { requireUser } from "@/features/auth/authorization";
import { getManualBookCategories, searchOwnedVolumes } from "@/features/books/queries";
import { AladinQuickAdd } from "@/components/books/aladin-quick-add";
import { searchAladinBooks } from "@/features/aladin/service";
import { withOwnership } from "@/features/aladin/ownership";
import { errorMessage } from "@/lib/errors";
import type { AladinSearchResult } from "@/features/aladin/types";
import { CoverImage } from "@/components/ui/cover-image";
import { formatWon } from "@/lib/format";
import { FlashMessage } from "@/components/ui/flash-message";

export const metadata = { title: "보유 권 검색" };
export default async function ProductsPage({ searchParams }: {
  searchParams: Promise<{ ownedQ?: string; q?: string; ownedPage?: string; ownedSort?: string; aladinPage?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  let aladin: AladinSearchResult | null = null;
  let error = "";
  if (params.q?.trim()) {
    try { aladin = withOwnership(user.id, await searchAladinBooks({ query: params.q, page: Number(params.aladinPage) || 1 })); }
    catch (cause) { error = errorMessage(cause); }
  }
  const result = searchOwnedVolumes(user.id, { query: params.ownedQ, page: Number(params.ownedPage), sort: params.ownedSort });
  function href(page: number) {
    return `/products?${new URLSearchParams({ ownedQ: result.query, ownedSort: params.ownedSort ?? "id", ownedPage: String(page), ...(params.q ? { q: params.q, aladinPage: params.aladinPage ?? "1" } : {}) })}`;
  }
  return <div className="page"><header className="page-header"><div><h1 className="page-title">보유 권 검색</h1>
    <p className="page-subtitle">등록한 권의 제목과 ISBN으로 검색합니다.</p></div><Link className="button button-outline" href="/aladin/search">알라딘 검색</Link></header>
    <details className="details-card" open={Boolean(params.q)}><summary>알라딘 상품 검색·한 권씩 등록</summary><div className="details-body stack-md">
      <FlashMessage error={error}/>
      <AladinQuickAdd key={`${params.q}:${params.aladinPage}`} initialQuery={params.q ?? ""} initial={aladin} categories={getManualBookCategories()}/>
    </div></details>
    <SearchForm className="panel search-form" action="/products">
      {params.q && <><input type="hidden" name="q" value={params.q}/><input type="hidden" name="aladinPage" value={params.aladinPage ?? "1"}/></>}
      <div className="field"><label htmlFor="owned-query">권 제목·ISBN</label>
      <input className="input" id="owned-query" name="ownedQ" defaultValue={result.query} maxLength={200}/></div>
      <div className="field"><label htmlFor="owned-sort">정렬</label><select className="select" id="owned-sort" name="ownedSort" defaultValue={params.ownedSort ?? "id"}>
        <option value="id">등록 번호</option><option value="recent">최근 등록일</option><option value="name">제목</option><option value="price">가격</option><option value="volume">권차</option>
      </select></div><button className="button" type="submit">권 검색</button></SearchForm>
    <p className="muted">{result.total}권 · {result.page}/{result.totalPages}페이지</p>
    <div className="stock-list">{result.items.map((item) => <article className="stock-card" key={item.id}>
      <div className="stock-cover"><CoverImage cover={item.cover} alt={item.name ?? "책"}/></div>
      <div className="stack-xs"><BookDetailLink className="volume-title-link" bookId={item.bookId}>{item.name ?? "제목 없음"}</BookDetailLink>
        <p className="muted small">{item.bookName} · {item.isbn13 ?? "ISBN 미상"}</p>
        <div className="button-row">{Boolean(item.isPurchased) && <span className="chip">구매 완료</span>}
          {Boolean(item.noNeedToBuy) && <span className="chip">구매 불필요</span>}<strong>{item.price ? formatWon(item.price) : "가격 미상"}</strong></div>
      </div></article>)}</div>
    {!result.items.length && <p className="empty">검색 결과가 없습니다.</p>}
    <Pagination page={result.page} totalPages={result.totalPages} href={href} label="보유 권 페이지"/>
  </div>;
}
