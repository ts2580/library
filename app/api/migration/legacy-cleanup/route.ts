import { requireApiAdmin } from "@/features/auth/authorization";
import { createLegacyCleanupService } from "@/features/migration/legacy-cleanup-service";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await requireApiAdmin(); return Response.json(await createLegacyCleanupService().status(), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return jsonError(error); }
}
export async function POST(request: Request) {
  try {
    await requireApiAdmin(); assertSameOrigin(request);
    return Response.json(await createLegacyCleanupService().remove(), { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error, "기존 데이터 정리에 실패했습니다. 상태를 확인하고 다시 시도하세요."); }
}
