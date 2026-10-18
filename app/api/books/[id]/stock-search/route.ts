import { requireApiAdmin, assertBookOwnership } from "@/features/auth/authorization";
import { entityIdSchema } from "@/features/books/validation";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { requestBookStockSearch } from "@/features/inventory/service";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireApiAdmin();
    const id = entityIdSchema.parse((await context.params).id);
    assertBookOwnership(id, user.id);
    return Response.json(getStockRefreshProgress(user.id), { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireApiAdmin();
    const id = entityIdSchema.parse((await context.params).id);
    const result = requestBookStockSearch(user.id, id);
    return Response.json({ ...result, progress: getStockRefreshProgress(user.id) }, { status: result.started ? 202 : 409 });
  } catch (error) { return jsonError(error); }
}
