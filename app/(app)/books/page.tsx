import { BookSearchForm } from "@/components/books/book-search-form";
import Link from "next/link";
import { requireUser } from "@/features/auth/authorization";
import { getBookList, getManualBookCategories, getOwnedBookOptions, searchOwnedVolumes } from "@/features/books/queries";
import { BookCard } from "@/components/books/book-card";
import { ManualBookCreate } from "@/components/books/manual-book-create";
import { Pagination } from "@/components/books/pagination";
import { FlashMessage } from "@/components/ui/flash-message";
import { VolumeSearchResults } from "@/components/books/volume-search-results";

export const metadata = { title: "책장" };

type Search = { mode?: string; page?: string; title?: string; author?: string; isbn?: string; type?: string; message?: string; error?: string };
export default async function BooksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const query = await searchParams;
  const page = Number.isFinite(Number(query.page)) ? Math.max(1, Number(query.page)) : 1;
  const detailed = query.mode === "detail";
  const field = detailed && query.isbn !== undefined ? "isbn" : query.author !== undefined && query.title === undefined ? "author" : "title";
  const keyword = query[field] ?? "";
  const preserved = { [field]: keyword, type: query.type, ...(detailed ? { mode: "detail" } : {}) };
  const result = getBookList(user.id, { page, ...preserved });
  const volumes = detailed ? searchOwnedVolumes(user.id, { query: keyword, field, type: query.type, page }) : null;
  return (
    <div className="page">
      <header className="page-header books-page-header">
        <div><p className="eyebrow">My library</p><h1 className="page-title">책장</h1><p className="page-subtitle">{volumes ? `총 ${volumes.total.toLocaleString("ko-KR")}권 · ${volumes.page}/${volumes.totalPages}페이지` : `총 ${result.totalCount.toLocaleString("ko-KR")}개 시리즈 중 ${result.from}–${result.to}`}</p></div>
        <div className="button-row"><Link className="button button-outline button-small" href="/products">보유 권 검색</Link><ManualBookCreate categories={getManualBookCategories()} options={getOwnedBookOptions(user.id)}/></div>
      </header>
      <FlashMessage message={query.message} error={query.error}/>
      <section className="panel panel-soft stack-md">
        <nav className="books-search-modes" aria-label="책장 검색 방식">
          <Link href="/books" aria-current={!detailed ? "page" : undefined}>일반 책 검색</Link>
          <Link href="/books?mode=detail" aria-current={detailed ? "page" : undefined}>책 상세 검색</Link>
        </nav>
        <p className="muted small">{detailed ? "개별 권의 제목·저자·ISBN으로 검색합니다. ISBN 없는 권도 제목과 저자로 찾을 수 있습니다." : "책·시리즈의 제목과 저자로 검색합니다."}</p>
        <BookSearchForm key={`${detailed}:${field}:${keyword}:${query.type ?? ""}`} categories={result.categories} initialField={field} initialQuery={keyword} type={query.type ?? ""} detailed={detailed}/>
      </section>
      {volumes ? <VolumeSearchResults items={volumes.items}/> : result.items.length ? <div className="book-grid">{result.items.map((book) => <BookCard key={book.id} book={book}/>)}</div> : <div className="empty">조건에 맞는 책이 없습니다.</div>}
      <Pagination page={volumes?.page ?? result.page} totalPages={volumes?.totalPages ?? result.totalPages} searchParams={preserved}/>
    </div>
  );
}
