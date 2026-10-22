"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { useBookStockSearch, type BookStockSearchOptions } from "@/components/inventory/use-book-stock-search";

export function VolumeAddTools({ bookId, manual, stockSearch }: { bookId: number; manual: ReactNode; stockSearch?: BookStockSearchOptions }) {
  const [manualOpen, setManualOpen] = useState(false);
  const id = useId();
  const stock = useBookStockSearch(stockSearch);
  return <div className="stack-md">
    <div className="button-row volume-add-actions">
      <button type="button" className="button button-outline button-small" aria-expanded={manualOpen} aria-controls={`${id}-manual`}
        onClick={() => setManualOpen(open => !open)}>직접 추가</button>
      <Link className="button button-secondary button-small" href={`/aladin/search?bookId=${bookId}`}>알라딘에서 추가</Link>
      {stockSearch && <button type="button" className="button button-outline button-small" title="현재 책의 구매 필요 권만 검색해 기존 재고에 추가합니다." disabled={stock.disabled} onClick={() => void stock.start()}>재고 검색</button>}
    </div>
    {stockSearch && stock.error && <p className="flash flash-error" role="alert">{stock.error}</p>}
    {stockSearch && stock.message && <p className="muted small" role="status">{stock.message}</p>}
    <section id={`${id}-manual`} aria-label="권 직접 추가" hidden={!manualOpen}>{manual}</section>
  </div>;
}
