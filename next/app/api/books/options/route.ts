import { requireApiUser } from "@/features/auth/authorization";
import { getOwnedBookOptions } from "@/features/books/queries";
import { jsonError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const query = new URL(request.url).searchParams.get("query")?.slice(0, 200) ?? "";
    return Response.json(getOwnedBookOptions(user.id, query), { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
