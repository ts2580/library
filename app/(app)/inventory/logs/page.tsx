import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth/authorization";
import { getStockRefreshLogs, getStockRunDetail } from "@/features/inventory/refresh-log";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { StockRefreshLogs } from "@/components/inventory/stock-refresh-logs";
import { NotFoundError } from "@/lib/errors";

export const metadata = { title: "재고 갱신 로그" };

export default async function StockRefreshLogsPage({ searchParams }: { searchParams: Promise<{ page?: string; runId?: string }> }) {
  const user = await requireAdmin();
  const { page, runId } = await searchParams;
  let logs;
  try {
    logs = runId ? getStockRunDetail(user.id, runId, Number(page)) : getStockRefreshLogs(user.id, { page: Number(page), status: "all" });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">Refresh history</p><h1 className="page-title">{runId ? "재고 갱신 작업 상세" : "재고 갱신 로그"}</h1></div>
      <div className="button-row">{runId && <Link className="button button-secondary" href="/inventory/logs">작업 기록</Link>}
      <Link className="button button-secondary" href="/inventory">지점 재고로</Link></div></header>
    <StockRefreshLogs key={JSON.stringify([runId, logs.page])} initial={{ logs, progress: getStockRefreshProgress(user.id) }} runId={runId}/>
  </div>;
}
