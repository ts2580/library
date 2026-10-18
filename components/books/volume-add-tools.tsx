"use client";

import { useId, useState, type ReactNode } from "react";
import { useBookStockSearch, type BookStockSearchOptions } from "@/components/inventory/use-book-stock-search";

export function VolumeAddTools({ manual, search, stockSearch }: { manual: ReactNode; search: ReactNode; stockSearch?: BookStockSearchOptions }) {
  const [active, setActive] = useState<"manual" | "search" | null>(null);
  const id = useId();
  const stock = useBookStockSearch(stockSearch);
  return <div className="stack-md">
    <div className="button-row volume-add-actions">
      {([{ key: "manual", label: "직접 추가" }, { key: "search", label: "알라딘에서 검색" }] as const).map(({ key, label }) =>
        <button key={key} type="button" className="button button-outline button-small" aria-expanded={active === key} aria-controls={`${id}-${key}`}
          onClick={() => setActive(active === key ? null : key)}>{label}</button>)}
      {stockSearch && <button type="button" className="button button-outline button-small" title="현재 책의 구매 필요 권만 검색해 기존 재고에 추가합니다." disabled={stock.disabled} onClick={() => void stock.start()}>재고 검색</button>}
    </div>
    {stockSearch && stock.error && <p className="flash flash-error" role="alert">{stock.error}</p>}
    {stockSearch && stock.message && <p className="muted small" role="status">{stock.message}</p>}
    <section id={`${id}-manual`} aria-label="권 직접 추가" hidden={active !== "manual"}>{manual}</section>
    <section id={`${id}-search`} aria-label="알라딘에서 권 검색" hidden={active !== "search"}>{search}</section>
  </div>;
}
