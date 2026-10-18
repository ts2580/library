import { BookSearchForm } from "@/components/books/book-search-form";
import { requireUser } from "@/features/auth/authorization";
import { getBookList, getManualBookCategories, getOwnedBookOptions } from "@/features/books/queries";
import { BookCard } from "@/components/books/book-card";
import { ManualBookCreate } from "@/components/books/manual-book-create";
import { Pagination } from "@/components/books/pagination";
import { FlashMessage } from "@/components/ui/flash-message";

export const metadata = { title: "책장" };

type Search = { page?: string; title?: string; author?: string; type?: string; message?: string; error?: string };
export default async function BooksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const query = await searchParams;
  const page = Number.isFinite(Number(query.page)) ? Math.max(1, Number(query.page)) : 1;
  const field = query.author !== undefined && query.title === undefined ? "author" : "title";
  const keyword = query[field] ?? "";
  const preserved = { [field]: keyword, type: query.type };
  const result = getBookList(user.id, { page, ...preserved });
  return (
    <div className="page">
      <header className="page-header books-page-header">
        <div><p className="eyebrow">My library</p><h1 className="page-title">책장</h1><p className="page-subtitle">총 {result.totalCount.toLocaleString("ko-KR")}개 시리즈 중 {result.from}–{result.to}</p></div>
        <ManualBookCreate categories={getManualBookCategories()} options={getOwnedBookOptions(user.id)}/>
      </header>
      <FlashMessage message={query.message} error={query.error}/>
      <section className="panel panel-soft stack-md">
        <BookSearchForm key={`${field}:${keyword}:${query.type ?? ""}`} categories={result.categories} initialField={field} initialQuery={keyword} type={query.type ?? ""}/>
      </section>
      {result.items.length ? <div className="book-grid">{result.items.map((book) => <BookCard key={book.id} book={book}/>)}</div> : <div className="empty">조건에 맞는 책이 없습니다.</div>}
      <Pagination page={result.page} totalPages={result.totalPages} searchParams={preserved}/>
    </div>
  );
}
