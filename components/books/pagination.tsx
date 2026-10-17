import Link from "next/link";

export function Pagination({
  page,
  totalPages,
  searchParams
}: {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;
  const first = Math.max(1, page - 3);
  const last = Math.min(totalPages, page + 3);
  const pages = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  function href(target: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) if (value) params.set(key, value);
    params.set("page", String(target));
    return `/books?${params.toString()}`;
  }
  return (
    <nav className="pagination" aria-label="책 목록 페이지">
      {page > 1 && <Link className="page-link" href={href(page - 1)}>이전</Link>}
      {first > 1 && <><Link className="page-link" href={href(1)}>1</Link><span className="page-link" aria-hidden="true">…</span></>}
      {pages.map((item) => <Link key={item} className={`page-link ${item === page ? "page-link-current" : ""}`} href={href(item)} aria-current={item === page ? "page" : undefined}>{item}</Link>)}
      {last < totalPages && <><span className="page-link" aria-hidden="true">…</span><Link className="page-link" href={href(totalPages)}>{totalPages}</Link></>}
      {page < totalPages && <Link className="page-link" href={href(page + 1)}>다음</Link>}
    </nav>
  );
}
