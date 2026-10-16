import { requireApiAdmin } from "@/features/auth/authorization";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { deleteOwnerInventory, requestStockRefresh } from "@/features/inventory/service";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiAdmin();
    return Response.json(getStockRefreshProgress(user.id), { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiAdmin();
    const result = requestStockRefresh(user.id);
    return Response.json({ ...result, progress: getStockRefreshProgress(user.id) }, { status: result.started ? 202 : 409 });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiAdmin();
    deleteOwnerInventory(user.id);
    return Response.json({ success: true, progress: getStockRefreshProgress(user.id) });
  } catch (error) { return jsonError(error); }
}
