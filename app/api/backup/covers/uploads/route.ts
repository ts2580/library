import { z } from "zod";
import { requireApiUser } from "@/features/auth/authorization";
import { createCoverUpload } from "@/features/backup/upload";
import { assertSameOrigin, jsonError } from "@/lib/http";

const inputSchema = z.object({ filename: z.string().trim().min(1).max(255), totalSize: z.number().int().positive(), totalChunks: z.number().int().positive() });
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const input = inputSchema.parse(await request.json());
    const job = createCoverUpload(user.id, input);
    return Response.json(job, { status: 201 });
  } catch (error) { return jsonError(error); }
}
