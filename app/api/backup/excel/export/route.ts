import { requireApiUser } from "@/features/auth/authorization";
import { exportExcelBackup } from "@/features/backup/excel";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await requireApiUser();
    const output = await exportExcelBackup(user.id, user.username);
    const safe = user.username.replace(/[^A-Za-z0-9_-]/g, "_");
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(output), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="bookshelf-backup-${safe}-${date}.xlsx"`,
      "content-length": String(output.length),
      "cache-control": "no-store"
    }});
  } catch (error) { return jsonError(error); }
}
