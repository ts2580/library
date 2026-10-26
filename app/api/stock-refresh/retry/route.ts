import { z } from "zod";
import { requireApiAdmin } from "@/features/auth/authorization";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { retryStockRefresh } from "@/features/inventory/service";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiAdmin();
    const input = z.object({ volumeIds: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(5000).optional() })
      .strict().parse(await request.json().catch(() => null));
    const result = retryStockRefresh(user.id, input.volumeIds);
    return Response.json({ ...result, progress: getStockRefreshProgress(user.id) }, { status: result.started ? 202 : 409 });
  } catch (error) { return jsonError(error); }
}
