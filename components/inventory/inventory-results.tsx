import { SearchForm } from "@/components/ui/search-form";
import { Pagination } from "@/components/ui/pagination";
import Link from "next/link";
import { CoverImage } from "@/components/ui/cover-image";
import { ExternalLink } from "@/components/ui/external-link";
import { formatWon } from "@/lib/format";
import type { searchInventory } from "@/features/inventory/queries";

export function InventoryResults({ result, branch }: { result: ReturnType<typeof searchInventory>; branch?: string }) {
  const base = branch ? `/inventory/branches/${encodeURIComponent(branch)}` : "/inventory";
  function href(page: number) {
    const params = new URLSearchParams({ page: String(page) });
    if (result.query) params.set("q", result.query);
    return `${base}?${params}`;
  }
  return <section className="stack-md" aria-label="재고 검색">
    <SearchForm className="search-form" action={base}>
      <div className="field"><label htmlFor="inventory-query">제목·ISBN·지점 검색</label>
        <input className="input" id="inventory-query" name="q" maxLength={200} defaultValue={result.query}/></div>
      <button className="button" type="submit">재고 검색</button>
    </SearchForm>
    <p className="muted small">{result.total.toLocaleString("ko-KR")}건 · {result.page}/{result.totalPages}페이지</p>
    <div className="stock-list">{result.items.map((item) => <article className="stock-card" key={item.id}>
      <div className="stock-cover"><CoverImage cover={item.cover} alt={item.volumeName ?? item.bookName ?? "책"}/></div>
      <div className="stack-xs"><Link className="volume-title-link" href={`/books/${item.bookId}`}>{item.volumeName ?? item.bookName ?? "제목 없음"}</Link>
        <p className="muted small">{item.branchName} · {item.isbn13 ?? "ISBN 미상"}</p>
        <div className="button-row">{item.grade && <span className="chip">{item.grade}</span>}<strong>{item.price ? formatWon(item.price) : "가격 미상"}</strong></div>
      </div><div className="button-row"><ExternalLink className="button button-secondary button-small" href={item.purchaseUrl}>구매</ExternalLink></div>
    </article>)}</div>
    {!result.items.length && <p className="empty">검색 결과가 없습니다.</p>}
    <Pagination page={result.page} totalPages={result.totalPages} href={href} label="재고 페이지"/>
  </section>;
}
