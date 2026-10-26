import { requireApiAdmin } from "@/features/auth/authorization";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { getStockRefreshLogs } from "@/features/inventory/refresh-log";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireApiAdmin();
    const params = new URL(request.url).searchParams;
    return Response.json({ logs: getStockRefreshLogs(user.id, { page: Number(params.get("page")), status: params.get("status") === "all" ? "all" : "failed" }),
      progress: getStockRefreshProgress(user.id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
