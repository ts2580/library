import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/authorization";
import { searchOwnedVolumes } from "@/features/books/queries";
import { CoverImage } from "@/components/ui/cover-image";
import { formatWon } from "@/lib/format";

export const metadata = { title: "보유 권 검색" };
export default async function ProductsPage({ searchParams }: {
  searchParams: Promise<{ ownedQ?: string; q?: string; ownedPage?: string; ownedSort?: string; aladinPage?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  if (params.q && !params.ownedQ) redirect(`/aladin/search?query=${encodeURIComponent(params.q)}&page=${Number(params.aladinPage) || 1}`);
  const result = searchOwnedVolumes(user.id, { query: params.ownedQ, page: Number(params.ownedPage), sort: params.ownedSort });
  function href(page: number) {
    return `/products?${new URLSearchParams({ ownedQ: result.query, ownedSort: params.ownedSort ?? "id", ownedPage: String(page) })}`;
  }
  return <div className="page"><header className="page-header"><div><h1 className="page-title">보유 권 검색</h1>
    <p className="page-subtitle">등록한 권의 제목과 ISBN으로 검색합니다.</p></div><Link className="button button-outline" href="/aladin/search">알라딘 검색</Link></header>
    <form className="panel search-form" action="/products"><div className="field"><label htmlFor="owned-query">권 제목·ISBN</label>
      <input className="input" id="owned-query" name="ownedQ" defaultValue={result.query} maxLength={200}/></div>
      <div className="field"><label htmlFor="owned-sort">정렬</label><select className="select" id="owned-sort" name="ownedSort" defaultValue={params.ownedSort ?? "id"}>
        <option value="id">최근 등록</option><option value="name">제목</option><option value="price">가격</option><option value="volume">권차</option>
      </select></div><button className="button" type="submit">권 검색</button></form>
    <p className="muted">{result.total}권 · {result.page}/{result.totalPages}페이지</p>
    <div className="stock-list">{result.items.map((item) => <article className="stock-card" key={item.id}>
      <div className="stock-cover"><CoverImage cover={item.cover} alt={item.name ?? "책"}/></div>
      <div className="stack-xs"><Link className="volume-title-link" href={`/books/${item.bookId}`}>{item.name ?? "제목 없음"}</Link>
        <p className="muted small">{item.bookName} · {item.isbn13 ?? "ISBN 미상"}</p>
        <div className="button-row">{Boolean(item.isPurchased) && <span className="chip">구매 완료</span>}
          {Boolean(item.noNeedToBuy) && <span className="chip">구매 불필요</span>}<strong>{item.price ? formatWon(item.price) : "가격 미상"}</strong></div>
      </div></article>)}</div>
    {!result.items.length && <p className="empty">검색 결과가 없습니다.</p>}
    <nav className="button-row" aria-label="보유 권 페이지">{result.page > 1 && <Link className="button button-outline" href={href(result.page - 1)}>이전 페이지</Link>}
      {result.page < result.totalPages && <Link className="button button-outline" href={href(result.page + 1)}>다음 페이지</Link>}</nav>
  </div>;
}
