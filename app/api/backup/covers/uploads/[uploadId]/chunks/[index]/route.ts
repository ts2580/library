import { requireApiUser } from "@/features/auth/authorization";
import { saveCoverChunk } from "@/features/backup/upload";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function PUT(request: Request, { params }: { params: Promise<{ uploadId: string; index: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { uploadId, index } = await params;
    const job = await saveCoverChunk(user.id, uploadId, Number(index), request);
    return Response.json(job);
  } catch (error) { return jsonError(error); }
}
