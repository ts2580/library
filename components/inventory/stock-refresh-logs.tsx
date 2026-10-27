"use client";

import Link from "next/link";
import { BookDetailLink } from "@/components/books/book-detail-link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { clearReportedError, reportClientError } from "@/lib/client-errors";
import { ErrorReporter } from "@/components/ui/error-dialog";
import { Pagination } from "@/components/ui/pagination";
import { ProgressIndicator } from "@/components/ui/top-progress";
import type { StockRefreshLogPage, StockRefreshProgress } from "@/features/inventory/types";
import styles from "./stock-refresh-logs.module.css";

type Snapshot = { logs: StockRefreshLogPage; progress: StockRefreshProgress };
const labels = { SUCCESS: "성공", EMPTY: "재고 없음", FAILED: "실패" };

export function StockRefreshLogs({ initial, status }: { initial: Snapshot; status: "failed" | "all" }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestRevision = useRef(0);
  const mutating = useRef(false);
  const { logs, progress } = snapshot;
  const active = ["QUEUED", "RUNNING"].includes(progress.status);
  const disabled = busy || active || checking || unavailable;
  const initialKey = JSON.stringify(initial);
  const page = initial.logs.page;

  useEffect(() => {
    if (unavailable) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    async function refresh() {
      if (stopped || request || mutating.current) return;
      clearTimeout(timer);
      const controller = new AbortController();
      request = controller;
      const currentRevision = requestRevision.current;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let delay = 1500;
      try {
        const response = await apiFetch(`/api/stock-refresh/logs?status=${status}&page=${page}`, { cache: "no-store", signal: controller.signal }, { reportError: false });
        if (stopped || currentRevision !== requestRevision.current) return;
        if ([401, 403].includes(response.status)) { setUnavailable(true); throw new Error("로그인 또는 접근 권한을 확인할 수 없습니다. 다시 로그인해 주세요."); }
        const body = await response.json() as Snapshot & { message?: string };
        if (!response.ok) throw new Error(body.message ?? "갱신 로그를 조회하지 못했습니다.");
        if (stopped || controller.signal.aborted || currentRevision !== requestRevision.current) return;
        setSnapshot(body);
        setChecking(false);
        setError("");
        delay = ["QUEUED", "RUNNING"].includes(body.progress.status) ? 1500 : 10_000;
      } catch (cause) {
        if (stopped || currentRevision !== requestRevision.current) return;
        const message = controller.signal.aborted ? "갱신 로그 조회 시간이 초과되었습니다. 다시 시도합니다."
          : cause instanceof Error ? cause.message : "갱신 로그를 조회하지 못했습니다.";
        setError(message);
        reportClientError({ code: controller.signal.aborted ? "CLIENT_TIMEOUT" : "STOCK_LOGS_FAILED", message, source: "GET /api/stock-refresh/logs" });
      } finally {
        clearTimeout(timeout);
        request = undefined;
        if (!stopped) timer = setTimeout(() => void refresh(), delay);
      }
    }
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    timer = setTimeout(() => void refresh(), 0);
    return () => {
      stopped = true; clearTimeout(timer); request?.abort();
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [status, page, initialKey, revision, unavailable]);

  async function mutate(volumeIds?: number[], cancel = false) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true); setError(""); requestRevision.current++;
    clearReportedError("stock-log-mutation");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let code = "STOCK_RETRY_FAILED";
    try {
      const response = await apiFetch(cancel ? "/api/stock-refresh" : "/api/stock-refresh/retry", {
        method: cancel ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(cancel ? { runId: progress.runId } : { volumeIds }), signal: controller.signal
      }, { reportError: false });
      const body = await response.json() as { progress?: StockRefreshProgress; message?: string; code?: string };
      code = body.code ?? code;
      if (body.progress) setSnapshot(current => ({ ...current, progress: body.progress! }));
      if (!response.ok || !body.progress) throw new Error(body.message ?? "갱신 요청을 처리하지 못했습니다.");
      setSelected([]);
    } catch (cause) {
      const message = controller.signal.aborted ? "갱신 요청 시간이 초과되었습니다. 처리 여부를 다시 확인합니다."
        : cause instanceof Error ? cause.message : "갱신 요청을 처리하지 못했습니다.";
      setError(message);
      reportClientError({ code: controller.signal.aborted ? "CLIENT_TIMEOUT" : code, message, source: "stock-log-mutation" });
    } finally {
      clearTimeout(timeout); mutating.current = false; setBusy(false); setChecking(true); setRevision(current => current + 1);
    }
  }

  const eligible = [...new Set(logs.items.filter(item => item.retryable).map(item => item.volumeId))];
  const checked = selected.filter(id => eligible.includes(id));
  function toggle(id: number) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }

  return <div className="stack-md">
    <section className="panel stack-md" aria-label="로그 갱신 작업">
      <div className="section-heading"><h2>미해결 실패 {logs.pendingFailures}권</h2><span className={`status-badge status-${progress.status.toLowerCase()}`}>{progress.status}</span></div>
      <p className="muted" aria-live="polite">{progress.message}</p>
      <p className="muted">선택한 권만 갱신합니다. 조회에 실패하면 해당 권의 기존 재고를 유지합니다.</p>
      <ErrorReporter message={progress.status === "FAILED" || (progress.status === "COMPLETED" && progress.fail > 0) ? progress.message : null} code={progress.status === "FAILED" ? "STOCK_REFRESH_FAILED" : "STOCK_REFRESH_PARTIAL_FAILURE"} source="stock-worker" eventId={progress.runId ?? progress.completionId ?? progress.updatedAt ?? undefined}/>
      {error && <p className="flash flash-error" role="alert">{error}</p>}
      {(busy || active || checking) && !unavailable && <ProgressIndicator label={checking ? "갱신 상태 확인 중" : "재고 갱신 중"}/>}
      {active && <div className="progress-stats"><span>{progress.processed}/{progress.total}</span><span>성공 {progress.success}</span><span>재고 없음 {progress.empty}</span><span>실패 {progress.fail}</span></div>}
      <div className="button-row">
        <button className="button" disabled={disabled || logs.pendingFailures === 0} onClick={() => void mutate()}>실패 건 재시도 ({logs.pendingFailures})</button>
        <button className="button button-secondary" disabled={disabled || !checked.length} onClick={() => void mutate(checked)}>선택 갱신 ({checked.length})</button>
        {active && progress.runId !== undefined && <button className="button button-danger-outline" disabled={busy || unavailable} onClick={() => void mutate(undefined, true)}>갱신 취소</button>}
      </div>
    </section>
    <div className="section-heading"><div className="button-row" aria-label="로그 필터">
      <Link className={`button ${status === "failed" ? "" : "button-secondary"}`} aria-current={status === "failed" ? "page" : undefined} href="/inventory/logs">미해결 실패</Link>
      <Link className={`button ${status === "all" ? "" : "button-secondary"}`} aria-current={status === "all" ? "page" : undefined} href="/inventory/logs?status=all">전체 기록</Link>
    </div><span className="muted">{logs.total}건</span></div>
    {logs.items.length ? <>
      <label className={styles.select}><input type="checkbox" checked={eligible.length > 0 && checked.length === eligible.length} disabled={disabled || !eligible.length}
        onChange={event => setSelected(event.target.checked ? eligible : [])}/>이 페이지 전체 선택</label>
      <div className="stack-md">{logs.items.map(item => <article key={item.id} className={`panel ${styles.entry}`} data-testid="stock-log-entry">
        <div className={styles.heading}><div className={styles.select}><input type="checkbox" aria-label={`${item.volumeName} 로그 ${item.id} 선택`}
          checked={checked.includes(item.volumeId)} disabled={disabled || !item.retryable} onChange={() => toggle(item.volumeId)}/><BookDetailLink bookId={item.bookId}>{item.bookName}</BookDetailLink></div>
          <span className={`status-badge ${item.status === "FAILED" ? "status-failed" : "status-completed"}`}>{labels[item.status]}</span></div>
        <h3>{item.volumeName}{item.volume != null && <span className="muted"> · {item.volume}권</span>}</h3>
        <p className="muted">ISBN {item.isbn13 || "미등록"} · {item.createdAt} UTC</p>
        <p className={styles.reason}>{item.message}</p>
        <div className={styles.footer}><code>{item.code}</code><button className="button button-secondary" disabled={disabled || !item.retryable}
          onClick={() => void mutate([item.volumeId])}>개별 갱신</button></div>
      </article>)}</div>
      <Pagination page={logs.page} totalPages={logs.totalPages} label="갱신 로그 페이지" href={target => `/inventory/logs?status=${status}&page=${target}`}/>
    </> : <div className="empty">{status === "failed" ? "미해결 갱신 실패가 없습니다." : "아직 갱신 기록이 없습니다."}<br/>상세 기록은 이 버전에서 실행한 작업부터 저장됩니다.</div>}
  </div>;
}
