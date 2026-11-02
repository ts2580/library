import Link from "next/link";
import { requireAdmin } from "@/features/auth/authorization";
import { getStockRefreshLogs } from "@/features/inventory/refresh-log";
import { getStockRefreshProgress } from "@/features/inventory/queries";
import { StockRefreshLogs } from "@/components/inventory/stock-refresh-logs";

export const metadata = { title: "재고 갱신 로그" };

export default async function StockRefreshLogsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const user = await requireAdmin();
  const params = await searchParams;
  const status = params.status === "failed" ? "failed" : "all";
  const logs = getStockRefreshLogs(user.id, { page: Number(params.page), status });
  return <div className="page">
    <header className="page-header"><div><p className="eyebrow">Refresh history</p><h1 className="page-title">재고 갱신 로그</h1>
      <p className="page-subtitle">작업별 권수와 소요 시간을 확인합니다. 미해결 실패는 권별로 확인할 수 있습니다.</p></div>
      <Link className="button button-secondary" href="/inventory">지점 재고로</Link></header>
    <StockRefreshLogs initial={{ logs, progress: getStockRefreshProgress(user.id) }} status={status}/>
  </div>;
}
