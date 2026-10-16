"use client";

import { useId, useState } from "react";
import { formatWon } from "@/lib/format";

export function CategorySummary({ items }: { items: Array<{ category: string; volumeCount: number; totalAmount: number }> }) {
  const id = useId();
  const [metric, setMetric] = useState("count");
  const value = (item: typeof items[number]) => metric === "count" ? item.volumeCount : item.totalAmount;
  const maximum = Math.max(1, ...items.map(value));
  return <section className="panel stack-md" aria-labelledby={`${id}-title`}>
    <div className="section-heading"><div><p className="eyebrow">Categories</p><h2 id={`${id}-title`}>분류별 현황</h2></div><span className="chip">{items.length}개 분류</span></div>
    <div className="field"><label htmlFor={id}>비교 기준</label><select className="select" id={id} value={metric} onChange={(event) => setMetric(event.target.value)}>
      <option value="count">권수</option><option value="amount">전체 도서 금액</option>
    </select></div>
    {items.length ? <div className="category-list">{items.map((item) => <div className="category-row" key={item.category}>
      <div className="category-name" title={item.category}>{item.category}</div><div className="bar-track" aria-hidden="true"><div style={{ width: `${value(item) * 100 / maximum}%` }}/></div>
      <div className="category-value">{metric === "count" ? `${item.volumeCount}권` : formatWon(item.totalAmount)}</div>
    </div>)}</div> : <div className="empty">아직 등록된 권이 없습니다.</div>}
  </section>;
}
