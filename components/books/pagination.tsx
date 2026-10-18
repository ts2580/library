import { Pagination as PageNavigation } from "@/components/ui/pagination";

export function Pagination({
  page,
  totalPages,
  searchParams
}: {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
}) {
  function href(target: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) if (value) params.set(key, value);
    params.set("page", String(target));
    return `/books?${params.toString()}`;
  }
  return <PageNavigation page={page} totalPages={totalPages} href={href} label="책 목록 페이지"/>;
}
