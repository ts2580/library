import { requireApiUser } from "@/features/auth/authorization";
import { lookupUsedStocks } from "@/features/aladin/service";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireApiUser();
    const params = new URL(request.url).searchParams;
    const isbn = params.get("isbn") ?? params.get("isbn13") ?? "";
    const result = await lookupUsedStocks(isbn, params.get("type") ?? undefined);
    return Response.json(result, { status: result.successful ? 200 : 502, headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
