import Link from "next/link";
import { requireAdmin } from "@/features/auth/authorization";
import { getStockRefreshLogs } from "@/features/inventory/refresh-log";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { StockRefreshLogs } from "@/components/inventory/stock-refresh-logs";

export const metadata = { title: "재고 갱신 로그" };

export default async function StockRefreshLogsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const user = await requireAdmin();
  const params = await searchParams;
  const status = params.status === "all" ? "all" : "failed";
  const logs = getStockRefreshLogs(user.id, { page: Number(params.page), status });
  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">Refresh history</p><h1 className="page-title">재고 갱신 로그</h1>
      <p className="page-subtitle">실패한 권의 원인을 확인하고 개별 또는 일괄 갱신할 수 있습니다.</p></div>
      <Link className="button button-secondary" href="/inventory">지점 재고로</Link></header>
    <StockRefreshLogs initial={{ logs, progress: getStockRefreshProgress(user.id) }} status={status}/>
  </div>;
}
