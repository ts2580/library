import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth/authorization";
import { getBranchInventory, searchInventory } from "@/features/inventory/queries";
import { InventoryResults } from "@/components/inventory/inventory-results";

export const metadata = { title: "지점 재고 상세" };
export default async function BranchPage({ params, searchParams }: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireAdmin();
  const { branch: branchParam } = await params;
  const query = await searchParams;
  // Next.js 16.4 encodes page params. Compare encoded identifiers without decoding user input.
  const summary = getBranchInventory(user.id).find((item) => encodeURIComponent(item.branch) === branchParam);
  if (!summary) notFound();
  const branch = summary.branch;
  const result = searchInventory(user.id, { branch, query: query.q, page: Number(query.page) });
  return <div className="page"><header className="page-header"><div><p className="eyebrow">Branch inventory</p>
    <h1 className="page-title">{summary.branchName}</h1><p className="page-subtitle">{summary.stockCount.toLocaleString("ko-KR")}건</p>
    </div><Link className="button button-outline" href="/inventory">← 지점 목록</Link></header>
    <InventoryResults result={result} branch={branch}/></div>;
}
