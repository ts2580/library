import { withOwnership } from "@/features/aladin/ownership";
import { requireUser } from "@/features/auth/authorization";
import { getOwnedBookOptions, getManualBookCategories } from "@/features/books/queries";
import { searchAladinBooks } from "@/features/aladin/service";
import { isAladinConfigured } from "@/features/aladin/client";
import { AladinSearchPanel } from "@/components/books/aladin-search-panel";
import { FlashMessage } from "@/components/ui/flash-message";
import { errorMessage } from "@/lib/errors";
import { aladinSearchOptionsSchema } from "@/features/aladin/validation";
import type { AladinSearchResult } from "@/features/aladin/types";

export const metadata = { title: "알라딘 검색" };
type Query = Record<string, string | undefined>;

export default async function AladinSearchPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireUser();
  const params = await searchParams;
  const page = Math.max(1, Math.min(50, Math.floor(Number(params.page ?? params.start) || 1)));
  const selectedBookId = Number(params.bookId) || null;
  const options = getOwnedBookOptions(user.id, "", selectedBookId);
  const selectedTitle = params.query === undefined ? options.find(book => book.id === selectedBookId)?.name.trim().slice(0, 200) ?? "" : "";
  const query = params.query?.trim().slice(0, 200) ?? selectedTitle;
  const searchOptions = aladinSearchOptionsSchema.parse({ queryType: !selectedTitle && params.queryType === "Author" ? "Author" : "Title" });
  let result: AladinSearchResult | null = null;
  let searchError: string | null = null;
  if (query && !searchError) {
    try { result = withOwnership(user.id, await searchAladinBooks({ ...searchOptions, query, page })); }
    catch (error) { searchError = errorMessage(error, "알라딘 검색 요청에 실패했습니다. 잠시 후 다시 시도해 주세요."); }
  }
  return <div className="page">
    <AladinSearchPanel key={selectedBookId} query={query} result={result} searchOptions={searchOptions} options={options} selectedBookId={selectedBookId} categories={getManualBookCategories()}>
    <FlashMessage message={params.message} error={params.error ?? searchError}/>
    {!isAladinConfigured() && <p className="flash flash-error" role="alert">알라딘 검색을 사용할 수 없습니다. 관리자에게 문의해 주세요.</p>}
    </AladinSearchPanel>
  </div>;
}
