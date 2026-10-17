import { requireApiUser } from "@/features/auth/authorization";
import { getCoverUploadStatus } from "@/features/backup/upload";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const user = await requireApiUser();
    const { uploadId } = await params;
    return Response.json(getCoverUploadStatus(user.id, uploadId), { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
