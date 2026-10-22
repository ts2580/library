import Link from "next/link";
import { requireAdmin } from "@/features/auth/authorization";
import { getBranchInventory, getStockRefreshProgress, searchInventory } from "@/features/inventory/queries";
import { InventoryResults } from "@/components/inventory/inventory-results";
import { StockRefreshPanel } from "@/components/inventory/stock-refresh-panel";
import { BranchInventoryChart } from "@/components/inventory/branch-inventory-chart";
import { formatWon } from "@/lib/format";

export const metadata = { title: "지점 재고" };
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requireAdmin();
  const branches = getBranchInventory(user.id);
  const progress = getStockRefreshProgress(user.id);
  const params = await searchParams;
  const result = searchInventory(user.id, { query: params.q, page: Number(params.page) });
  const stockCount = branches.reduce((sum, item) => sum + item.stockCount, 0);
  const totalAmount = branches.reduce((sum, item) => sum + item.totalAmount, 0);
  return (
    <div className="page"><header className="page-header"><div><p className="eyebrow">Used inventory</p><h1 className="page-title">지점 재고</h1><p className="page-subtitle">현재 계정의 구매 필요 권에 대한 알라딘 중고 재고입니다.</p></div><Link className="button button-secondary" href="/aladin/used">ISBN 단건 조회</Link></header>
      <section className="kpi-grid"><article className="kpi"><div className="kpi-label">지점</div><div className="kpi-value">{branches.length}</div></article><article className="kpi"><div className="kpi-label">재고 건수</div><div className="kpi-value">{stockCount.toLocaleString("ko-KR")}</div></article><article className="kpi"><div className="kpi-label">표시 가격 합계</div><div className="kpi-value">{formatWon(totalAmount)}</div></article><article className="kpi"><div className="kpi-label">작업 상태</div><div className="kpi-value kpi-status">{progress.status}</div></article></section>
      <StockRefreshPanel initial={progress}/>
      <BranchInventoryChart branches={branches}/>
      <InventoryResults result={result}/>
      <section className="stack-md"><div className="section-heading"><div><p className="eyebrow">Branches</p><h2>지점별 집계</h2></div></div>{branches.length ? <div className="inventory-grid">{branches.map((branch) => <Link className="branch-card" key={branch.branch} href={`/inventory/branches/${encodeURIComponent(branch.branch)}`}><div className="section-heading"><h3>{branch.branchName}</h3><span className="chip">{branch.stockCount}건</span></div><dl><div><dt>가격 확인</dt><dd>{branch.pricedCount}건</dd></div><div><dt>합계</dt><dd>{formatWon(branch.totalAmount)}</dd></div></dl></Link>)}</div> : <div className="empty">저장된 지점 재고가 없습니다. 워커를 실행한 뒤 갱신을 시작하세요.</div>}</section>
    </div>
  );
}
