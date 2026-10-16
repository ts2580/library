import Link from "next/link";
import { requireUser } from "@/features/auth/authorization";
import { getBookList, getManualBookCategories } from "@/features/books/queries";
import { createBookAction } from "@/features/books/actions";
import { BookCard } from "@/components/books/book-card";
import { BookForm } from "@/components/books/book-form";
import { Pagination } from "@/components/books/pagination";
import { FlashMessage } from "@/components/ui/flash-message";

export const metadata = { title: "책장" };

type Search = { page?: string; search?: string; title?: string; author?: string; type?: string; message?: string; error?: string };
export default async function BooksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const query = await searchParams;
  const page = Number.isFinite(Number(query.page)) ? Math.max(1, Number(query.page)) : 1;
  const result = getBookList(user.id, { page, search: query.search, title: query.title, author: query.author, type: query.type });
  const preserved = { search: query.search, title: query.title, author: query.author, type: query.type };
  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">My library</p><h1 className="page-title">책장</h1><p className="page-subtitle">총 {result.totalCount.toLocaleString("ko-KR")}개 시리즈 중 {result.from}–{result.to}</p></div><div className="button-row"><Link className="button button-secondary" href="/aladin/search">알라딘 검색</Link></div></header>
      <FlashMessage message={query.message} error={query.error}/>
      <div className="button-row"><Link className="button button-outline" href="/products">보유 권 검색</Link></div>
      <section className="panel panel-soft stack-md">
        <form className="filter-form" action="/books" method="get">
          <div className="field"><label htmlFor="search">통합 검색</label><input className="input" id="search" name="search" defaultValue={query.search ?? ""} placeholder="제목 또는 저자"/></div>
          <div className="field"><label htmlFor="title">제목</label><input className="input" id="title" name="title" defaultValue={query.title ?? ""}/></div>
          <div className="field"><label htmlFor="author">저자</label><input className="input" id="author" name="author" defaultValue={query.author ?? ""}/></div>
          <div className="field"><label htmlFor="type">분류</label><select className="select" id="type" name="type" defaultValue={query.type ?? ""}><option value="">전체</option>{result.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></div>
          <div className="button-row span-2"><button className="button" type="submit">검색</button><Link className="button button-outline" href="/books">초기화</Link></div>
        </form>
      </section>
      <details className="details-card"><summary><span>책 직접 추가</span><span className="chip">표지 파일 또는 URL</span></summary><div className="details-body"><BookForm action={createBookAction} categories={getManualBookCategories()} submitLabel="책 추가"/></div></details>
      {result.items.length ? <div className="book-grid">{result.items.map((book) => <BookCard key={book.id} book={book}/>)}</div> : <div className="empty">조건에 맞는 책이 없습니다.</div>}
      <Pagination page={result.page} totalPages={result.totalPages} searchParams={preserved}/>
    </div>
  );
}
