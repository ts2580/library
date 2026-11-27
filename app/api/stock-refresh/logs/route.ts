import { requireApiAdmin } from "@/features/auth/authorization";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { getStockRefreshLogs, getStockRunDetail } from "@/features/inventory/refresh-log";
import { AppError } from "@/lib/errors";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function GET(request: Request) {
  try {
    const user = await requireApiAdmin();
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page"));
    const runId = params.get("runId");
    const format = params.get("format");
    const headers = new Headers({ "cache-control": "no-store" });
    if (format) {
      if (!runId || !["csv", "json"].includes(format)) throw new AppError("작업과 다운로드 형식을 확인해 주세요.");
      const detail = getStockRunDetail(user.id, runId, 1, true);
      const run = detail.runs[0]!;
      headers.set("content-disposition", `attachment; filename="stock-run-${run.id}.${format}"`);
      if (format === "json") return Response.json({ run, pendingFailures: detail.pendingFailures, errors: detail.items.map(({ currentIsbn, ...entry }) => entry) }, { headers });
      headers.set("content-type", "text/csv; charset=utf-8");
      const columns = ["작업 ID","작업 상태","작업 메시지","전체 권수","처리","성공","재고 없음","실패","책 제목","권 제목","권 번호","ISBN","오류 코드","오류 내용","발생 시각 (UTC)","처리 상태","재시도 가능"];
      const summary = [runId,run.status,run.message,run.total,run.processed,run.success,run.empty,run.fail];
      const rows = detail.items.map(e => [...summary,e.bookName,e.volumeName,e.volume,e.isbn13,e.code,e.message,e.createdAt,e.resolution,e.retryable ? "예" : "아니오"]);
      if (!rows.length) rows.push([...summary, ...Array(9).fill("")]);
      return new Response("\uFEFF" + [columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n"), { headers });
    }
    const logs = runId ? getStockRunDetail(user.id, runId, page)
      : getStockRefreshLogs(user.id, { page, status: params.get("status") === "failed" ? "failed" : "all" });
    return Response.json({ logs, progress: getStockRefreshProgress(user.id) }, { headers });
  } catch (error) { return jsonError(error); }
}
