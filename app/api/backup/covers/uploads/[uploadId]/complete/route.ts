import { requireApiUser } from "@/features/auth/authorization";
import { completeCoverUpload } from "@/features/backup/upload";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { uploadId } = await params;
    const job = await completeCoverUpload(user.id, uploadId);
    return Response.json(job, { status: 202 });
  } catch (error) { return jsonError(error); }
}
