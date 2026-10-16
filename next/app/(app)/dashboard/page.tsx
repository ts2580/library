import Link from "next/link";
import { requireUser } from "@/features/auth/authorization";
import { getDashboardData } from "@/features/dashboard/queries";
import { getBookList } from "@/features/books/queries";
import { formatWon } from "@/lib/format";
import { FlashMessage } from "@/components/ui/flash-message";
import { BookCard } from "@/components/books/book-card";

export const metadata = { title: "대시보드" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const user = await requireUser();
  const [query, dashboard] = await Promise.all([searchParams, Promise.resolve(getDashboardData(user.id))]);
  const recent = getBookList(user.id, { page: 1 }).items.slice(0, 4);
  const maxCategory = Math.max(1, ...dashboard.categories.map((item) => item.volumeCount));
  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Overview</p><h1 className="page-title">{user.name ?? user.username}의 책장</h1><p className="page-subtitle">소유 도서와 구매 현황을 한 화면에서 확인합니다.</p></div><Link className="button" href="/books">책장 열기</Link></header>
      <FlashMessage message={query.message} error={query.error}/>
      <section className="kpi-grid" aria-label="책장 요약">
        <article className="kpi"><div className="kpi-label">도서 시리즈</div><div className="kpi-value">{dashboard.bookCount.toLocaleString("ko-KR")}</div></article>
        <article className="kpi"><div className="kpi-label">등록 권수</div><div className="kpi-value">{dashboard.volumeCount.toLocaleString("ko-KR")}</div></article>
        <article className="kpi"><div className="kpi-label">구매 금액</div><div className="kpi-value">{formatWon(dashboard.purchasedAmount)}</div></article>
        <article className="kpi"><div className="kpi-label">구매 예정</div><div className="kpi-value">{formatWon(dashboard.plannedPurchaseAmount)}</div></article>
      </section>
      <section className="panel stack-md" aria-labelledby="category-heading">
        <div className="section-heading"><div><p className="eyebrow">Categories</p><h2 id="category-heading">분류별 권수</h2></div><span className="chip">{dashboard.categories.length}개 분류</span></div>
        {dashboard.categories.length ? <div className="category-list">{dashboard.categories.slice(0, 12).map((item) => <div className="category-row" key={item.category}><div className="category-name">{item.category}</div><div className="bar-track" aria-hidden="true"><div style={{ width: `${Math.max(3, item.volumeCount * 100 / maxCategory)}%` }}/></div><div className="category-value">{item.volumeCount}권 · {formatWon(item.purchasedAmount)}</div></div>)}</div> : <div className="empty">아직 등록된 책이 없습니다.</div>}
      </section>
      <section className="stack-md" aria-labelledby="recent-heading">
        <div className="section-heading"><div><p className="eyebrow">Recently added</p><h2 id="recent-heading">최근 책</h2></div><Link className="button button-outline button-small" href="/books">전체 보기</Link></div>
        {recent.length ? <div className="book-grid">{recent.map((book) => <BookCard key={book.id} book={book}/>)}</div> : <div className="empty"><p>첫 책을 등록해 보세요.</p><Link className="button" href="/books">책 추가</Link></div>}
      </section>
    </div>
  );
}
