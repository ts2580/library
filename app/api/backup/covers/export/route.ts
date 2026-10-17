import { Readable } from "node:stream";
import { requireApiUser } from "@/features/auth/authorization";
import { createCoverArchive } from "@/features/backup/archive";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireApiUser();
    const archive = createCoverArchive(user.id);
    const safe = user.username.replace(/[^A-Za-z0-9_-]/g, "_");
    const date = new Date().toISOString().slice(0, 10);
    return new Response(Readable.toWeb(archive) as ReadableStream, { headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="bookshelf-covers-${safe}-${date}.zip"`,
      "cache-control": "no-store"
    }});
  } catch (error) { return jsonError(error); }
}
