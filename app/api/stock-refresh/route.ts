import { requireApiAdmin } from "@/features/auth/authorization";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { cancelStockRefresh, changeStockPause, claimStockErrorNotification, deleteOwnerInventory, requestStockRefresh } from "@/features/inventory/service";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { z } from "zod";

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

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiAdmin();
    const { runId, action } = z.object({ runId: z.string().min(1).max(200).nullable(), action: z.enum(["cancel", "pause", "resume", "notify"]).default("cancel") }).parse(await request.json().catch(() => null));
    if (action === "notify") return Response.json({ show: claimStockErrorNotification(user.id, runId) });
    if (action === "cancel") cancelStockRefresh(user.id, runId);
    else changeStockPause(user.id, runId, action);
    return Response.json({ success: true, progress: getStockRefreshProgress(user.id) });
  } catch (error) { return jsonError(error); }
}
