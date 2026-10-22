import Link from "next/link";
import type { BranchInventoryItem } from "@/features/inventory/types";
import { formatWon } from "@/lib/format";
import styles from "./branch-inventory-chart.module.css";

export function BranchInventoryChart({ branches }: { branches: BranchInventoryItem[] }) {
  const maximum = branches.reduce((max, branch) => Math.max(max, branch.totalAmount), 0);

  return (
    <section className="panel stack-md" aria-labelledby="branch-chart-title">
      <div className="section-heading">
        <div><p className="eyebrow">Branch comparison</p><h2 id="branch-chart-title">지점별 재고 금액 비교</h2></div>
      </div>
      <p className="muted small">가격이 확인된 전체 재고의 합계를 금액순으로 비교합니다. 지점을 누르면 상세 재고를 볼 수 있습니다.</p>
      {branches.length ? (
        <div>
          <ol className={styles.list} aria-label="지점별 재고 금액 순위">
            {branches.map(branch => (
              <li key={branch.branch}>
                <Link className={styles.row} href={`/inventory/branches/${encodeURIComponent(branch.branch)}`}>
                  <span className={styles.name}>{branch.branchName}</span>
                  <span className={styles.track} aria-hidden="true">
                    <span className={styles.bar} data-testid="branch-inventory-bar" style={{ width: `${maximum > 0 ? branch.totalAmount / maximum * 100 : 0}%` }}/>
                  </span>
                  <span className={styles.amount}>{branch.pricedCount ? formatWon(branch.totalAmount) : "가격 미확인"}</span>
                </Link>
              </li>
            ))}
          </ol>
          {maximum > 0 && <div className={styles.axis} aria-hidden="true"><div className={styles.scale}><span>0원</span><span>{formatWon(maximum)}</span></div></div>}
        </div>
      ) : <div className="empty">비교할 지점 재고가 없습니다.</div>}
    </section>
  );
}
