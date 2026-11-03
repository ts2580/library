import { requireApiUser } from "@/features/auth/authorization";
import { searchAladinBooks } from "@/features/aladin/service";
import { jsonError } from "@/lib/http";
import { withOwnership } from "@/features/aladin/ownership";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const result = await searchAladinBooks({ ...Object.fromEntries(url.searchParams), query: url.searchParams.get("query") ?? "", page: url.searchParams.get("page") ?? url.searchParams.get("start") ?? "1" });
    return Response.json(await withOwnership(user.id, result), { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
