import { requireApiUser } from "@/features/auth/authorization";
import { searchAladinBooks } from "@/features/aladin/service";
import { jsonError } from "@/lib/http";
import { withOwnership } from "@/features/aladin/ownership";
import { isAladinConfigured } from "@/features/aladin/client";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    if (!isAladinConfigured()) throw new AppError("알라딘 검색을 사용할 수 없습니다. 관리자에게 문의해 주세요.");
    const url = new URL(request.url);
    const result = await searchAladinBooks({ query: url.searchParams.get("query") ?? "", page: url.searchParams.get("page") ?? "1" });
    return Response.json(withOwnership(user.id, result), { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
