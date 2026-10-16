import { requireApiUser } from "@/features/auth/authorization";
import { searchAladinBooks } from "@/features/aladin/service";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const result = await searchAladinBooks({ query: url.searchParams.get("query") ?? "", page: url.searchParams.get("page") ?? "1" });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
