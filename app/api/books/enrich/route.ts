import { requireApiUser } from "@/features/auth/authorization";
import { getMetadataEnrichmentProgress, requestMetadataEnrichment } from "@/features/books/enrichment-job";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json({ progress: getMetadataEnrichmentProgress(user.id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const progress = requestMetadataEnrichment(user.id);
    return Response.json({ progress }, { status: progress.status === "COMPLETED" ? 200 : 202 });
  } catch (error) { return jsonError(error); }
}
