import { SearchForm } from "@/components/ui/search-form";
import Link from "next/link";
import { withOwnership } from "@/features/aladin/ownership";
import { requireUser } from "@/features/auth/authorization";
import { getOwnedBookOptions } from "@/features/books/queries";
import { searchAladinBooks } from "@/features/aladin/service";
import { isAladinConfigured } from "@/features/aladin/client";
import { AladinSelection } from "@/components/books/aladin-selection";
import { FlashMessage } from "@/components/ui/flash-message";
import { errorMessage } from "@/lib/errors";
import { aladinSearchOptionsSchema } from "@/features/aladin/validation";
import { AladinSearchFilters } from "@/components/books/aladin-search-filters";
import type { AladinSearchResult } from "@/features/aladin/types";

export const metadata = { title: "알라딘 검색" };
type Query = Record<string, string | undefined>;

export default async function AladinSearchPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireUser();
  const params = await searchParams;
  const query = params.query?.trim().slice(0, 200) ?? "";
  const page = Math.max(1, Math.min(50, Math.floor(Number(params.page ?? params.start) || 1)));
  const selectedBookId = Number(params.bookId) || null;
  const options = getOwnedBookOptions(user.id, "", selectedBookId);
  const parsedOptions = aladinSearchOptionsSchema.safeParse(params);
  const searchOptions = parsedOptions.success ? parsedOptions.data : aladinSearchOptionsSchema.parse({});
  let result: AladinSearchResult | null = null;
  let searchError: string | null = parsedOptions.success ? null : "검색 조건을 확인해 주세요.";
  if (query && !searchError) {
    try { result = withOwnership(user.id, await searchAladinBooks({ ...searchOptions, query, page })); }
    catch (error) { searchError = errorMessage(error, "알라딘 검색 요청에 실패했습니다. 잠시 후 다시 시도해 주세요."); }
  }
  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">Aladin API</p><h1 className="page-title">알라딘 도서 검색</h1>
      <p className="page-subtitle">여러 페이지에서 선택한 권을 새 책이나 기존 책에 한 번에 등록합니다.</p></div>
      <Link className="button button-outline" href="/aladin/used">ISBN 재고 조회</Link></header>
    <FlashMessage message={params.message} error={params.error ?? searchError}/>
    {!isAladinConfigured() && <p className="flash flash-error" role="alert">알라딘 검색을 사용할 수 없습니다. 관리자에게 문의해 주세요.</p>}
    <section className="panel panel-soft"><SearchForm className="search-form" action="/aladin/search">
      <div className="field"><label htmlFor="aladin-query">제목</label><input className="input" id="aladin-query" name="query" defaultValue={query} maxLength={200} required autoFocus/></div>
      {selectedBookId && <input type="hidden" name="bookId" value={selectedBookId}/>}
      <button className="button" type="submit">검색</button>
      <AladinSearchFilters options={searchOptions} page={page}/>
    </SearchForm></section>
    {result && <AladinSelection key={`${query}:${selectedBookId}:${JSON.stringify(searchOptions)}`} query={query} initial={result} searchOptions={searchOptions} initialOptions={options} selectedBookId={selectedBookId}/>}
  </div>;
}
