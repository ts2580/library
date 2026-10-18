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
  const bookId = options?.bookId;
  const initialKey = JSON.stringify(options?.initial);
  const snapshot = useRef(progress);
  const revision = useRef(0);
  const startInFlight = useRef(false);
  const previous = useRef({ bookId, progress });
  const previousInitial = useRef(initialKey);
  const previousBookId = useRef(bookId);
  const pollNow = useRef<() => void>(() => {});

  function accept(next: StockRefreshProgress | undefined) {
    snapshot.current = next;
    setProgress(next);
  }

  useEffect(() => {
    const before = previous.current;
    if (before.bookId === bookId && progress) {
      const ended = before.progress?.status === "QUEUED" || before.progress?.status === "RUNNING";
      const terminal = progress.status === "COMPLETED" || progress.status === "FAILED";
      const newCompletion = terminal && progress.runId && progress.runId !== before.progress?.runId;
      const ownerCompleted = progress.completionId && progress.completionId !== before.progress?.completionId;
      if (ownerCompleted || (!active && affectsBook && (ended || newCompletion))) router.refresh();
    }
    previous.current = { bookId, progress };
  }, [bookId, progress, active, affectsBook, router]);

  useEffect(() => {
    if (!bookId) return;
    if (previousBookId.current !== bookId) {
      previousBookId.current = bookId;
      previous.current = { bookId, progress: options?.initial };
      accept(options?.initial); setUnavailable(false); setError("");
      if (unavailable) return;
    }
    if (unavailable) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let failures = 0;
    let stopped = false;
    function schedule(delay?: number) {
      clearTimeout(timer);
      const running = snapshot.current?.status === "QUEUED" || snapshot.current?.status === "RUNNING";
      timer = setTimeout(() => void poll(), delay ?? (running ? 1500 : Math.min(30_000, 10_000 * (failures + 1))));
    }
    async function poll() {
      if (stopped || controller.signal.aborted) return;
      if (request || startInFlight.current) { schedule(); return; }
      request = new AbortController();
      const currentRequest = request;
      const abort = () => currentRequest.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 10_000);
      const requestRevision = revision.current;
      try {
        const response = await fetch(`/api/books/${bookId}/stock-search`, { cache: "no-store", signal: currentRequest.signal });
        if (controller.signal.aborted || requestRevision !== revision.current) return;
        if ([401, 403, 404].includes(response.status)) {
          stopped = true;
          accept(undefined); setUnavailable(true);
          setError(response.status === 404 ? "책을 찾을 수 없어 재고 상태 조회를 중단했습니다." : "로그인 또는 접근 권한을 확인할 수 없어 재고 상태 조회를 중단했습니다.");
          return;
        }
        if (!response.ok) throw new Error("재고 검색 진행 상태를 확인하지 못했습니다.");
        const next = await response.json() as StockRefreshProgress;
        if (!controller.signal.aborted && requestRevision === revision.current) { accept(next); setError(""); failures = 0; }
      } catch (cause) {
        if (!controller.signal.aborted && requestRevision === revision.current) {
          failures++;
          setError(currentRequest.signal.aborted ? "재고 상태 조회 시간이 초과되었습니다. 다시 시도합니다." : cause instanceof Error ? cause.message : "진행 상태를 확인하지 못했습니다.");
        }
      } finally {
        clearTimeout(timeout); controller.signal.removeEventListener("abort", abort); request = undefined;
        if (!controller.signal.aborted && !stopped) schedule();
      }
    }
    const refresh = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void poll(); } };
    pollNow.current = () => schedule(1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const changed = previousInitial.current !== initialKey;
    previousInitial.current = initialKey;
    schedule(changed ? 0 : active ? 1000 : 10_000);
    return () => {
      controller.abort(); clearTimeout(timer);
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  // A new server snapshot triggers a fresh read; it cannot overwrite a newer POST response.
  }, [bookId, initialKey, unavailable]);

  async function start() {
    if (!bookId || busy || active || unavailable) return;
    startInFlight.current = true; revision.current++;
    setBusy(true); setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/books/${bookId}/stock-search`, { method: "POST", signal: controller.signal });
      const body = await response.json() as { message?: string; progress?: StockRefreshProgress };
      if (body.progress) accept(body.progress);
      if (!response.ok) throw new Error(body.message ?? "재고 검색을 시작하지 못했습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "재고 검색을 시작하지 못했습니다."); }
    finally { clearTimeout(timeout); startInFlight.current = false; setBusy(false); pollNow.current(); }
  }
  return { start, disabled: busy || active || unavailable, error,
    message: busy ? "이 책의 재고 검색을 요청하고 있습니다." : forThisBook ? progress?.message : active ? "다른 재고 작업이 진행 중입니다. 완료 후 검색할 수 있습니다." : "" };
}
