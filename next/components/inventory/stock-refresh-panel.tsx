"use client";

import { useEffect, useState } from "react";
import type { StockRefreshProgress } from "@/features/inventory/types";

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "요청을 처리하지 못했습니다.");
  return body;
}

export function StockRefreshPanel({ initial }: { initial: StockRefreshProgress }) {
  const [progress, setProgress] = useState(initial);
  const [busy, setBusy] = useState(false);
  const active = progress.status === "QUEUED" || progress.status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/stock-refresh", { cache: "no-store", signal: controller.signal });
        const body = await responseBody<StockRefreshProgress>(response);
        setProgress(body);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProgress((current) => ({
          ...current,
          failed: true,
          message: error instanceof Error ? error.message : "진행 상태를 확인하지 못했습니다."
        }));
      }
    };
    const id = window.setInterval(() => void refresh(), 1500);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [active]);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch("/api/stock-refresh", { method: "POST" });
      const body = await responseBody<{ progress: StockRefreshProgress }>(response);
      setProgress(body.progress);
    } catch (error) {
      setProgress((current) => ({
        ...current,
        running: false,
        failed: true,
        status: "FAILED",
        message: error instanceof Error ? error.message : "작업을 등록하지 못했습니다."
      }));
    } finally {
      setBusy(false);
    }
  }

  async function clearInventory(): Promise<void> {
    if (!window.confirm("현재 계정의 지점 재고를 모두 삭제합니까?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/stock-refresh", { method: "DELETE" });
      const body = await responseBody<{ progress: StockRefreshProgress }>(response);
      setProgress(body.progress);
      window.location.reload();
    } catch (error) {
      setProgress((current) => ({
        ...current,
        message: error instanceof Error ? error.message : "재고를 삭제하지 못했습니다."
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack-md" aria-labelledby="stock-refresh-title">
      <div className="section-heading"><div><p className="eyebrow">Background worker</p><h2 id="stock-refresh-title">중고 재고 일괄 갱신</h2></div><span className={`status-badge status-${progress.status.toLowerCase()}`}>{progress.status}</span></div>
      <p className="muted" aria-live="polite">{progress.message}</p>
      <div className="progress-track" aria-label={`진행률 ${progress.percent}%`}><div style={{ width: `${progress.percent}%` }}/></div>
      <div className="progress-stats"><span>{progress.processed}/{progress.total}</span><span>성공 {progress.success}</span><span>재고없음 {progress.empty}</span><span>실패 {progress.fail}</span></div>
      <div className="button-row"><button className="button" type="button" onClick={start} disabled={busy || active}>{active ? "진행 중" : "갱신 시작"}</button><button className="button button-danger-outline" type="button" onClick={clearInventory} disabled={busy || active}>전체 삭제</button></div>
    </section>
  );
}
