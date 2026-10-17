import { sqlite } from "@/db";
export const runtime = "nodejs";
export async function GET() {
  try {
    sqlite.prepare("SELECT 1").get();
    return Response.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch { return Response.json({ status: "error" }, { status: 503 }); }
}
