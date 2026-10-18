"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTopProgress } from "@/components/ui/top-progress";
import type { StockRefreshProgress } from "@/features/inventory/types";

export type BookStockSearchOptions = { bookId: number; initial: StockRefreshProgress };

export function useBookStockSearch(options?: BookStockSearchOptions) {
  const router = useRouter();
  const [progress, setProgress] = useState(options?.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const active = progress?.status === "QUEUED" || progress?.status === "RUNNING";
  const forThisBook = progress?.mode === "APPEND_BOOK" && progress.scopeBookId === options?.bookId;
  const affectsBook = progress?.mode === "REPLACE_ALL" || forThisBook;
  useTopProgress(busy || Boolean(active && affectsBook));
  const wasActive = useRef(active);
  const bookId = options?.bookId;
  useEffect(() => {
    if (wasActive.current && !active && affectsBook) router.refresh();
    wasActive.current = active;
  }, [active, affectsBook, router]);

  useEffect(() => {
    if (!bookId || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/books/${bookId}/stock-search`, { cache: "no-store", signal: controller.signal });
        if ([401, 403, 404].includes(response.status)) {
          if (!controller.signal.aborted) {
            setProgress(undefined); setUnavailable(true);
            setError(response.status === 404 ? "책을 찾을 수 없어 재고 상태 조회를 중단했습니다." : "로그인 또는 접근 권한을 확인할 수 없어 재고 상태 조회를 중단했습니다.");
          }
          controller.abort();
          return;
        }
        if (!response.ok) throw new Error("재고 검색 진행 상태를 확인하지 못했습니다.");
        const next = await response.json() as StockRefreshProgress;
        if (!controller.signal.aborted) { setProgress(next); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "진행 상태를 확인하지 못했습니다.");
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500); }
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [bookId, active]);

  async function start() {
    if (!bookId || busy || active || unavailable) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/books/${bookId}/stock-search`, { method: "POST" });
      const body = await response.json() as { message?: string; progress?: StockRefreshProgress };
      if (body.progress) setProgress(body.progress);
      if (!response.ok) throw new Error(body.message ?? "재고 검색을 시작하지 못했습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "재고 검색을 시작하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return { start, disabled: busy || active || unavailable, error,
    message: busy ? "이 책의 재고 검색을 요청하고 있습니다." : forThisBook ? progress?.message : active ? "다른 재고 작업이 진행 중입니다. 완료 후 검색할 수 있습니다." : "" };
}
