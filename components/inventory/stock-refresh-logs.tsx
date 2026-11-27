"use client";

import Link from "next/link";
import { BookDetailLink } from "@/components/books/book-detail-link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { clearReportedError, reportClientError } from "@/lib/client-errors";
import { StockErrorNotice } from "./stock-error-notice";
import { Pagination } from "@/components/ui/pagination";
import { ProgressIndicator } from "@/components/ui/top-progress";
import type { StockRefreshLogPage, StockRefreshProgress, StockRefreshRun } from "@/features/inventory/types";
import styles from "./stock-refresh-logs.module.css";

type Snapshot = { logs: StockRefreshLogPage; progress: StockRefreshProgress };
const labels = { ARCHIVED: "이전 기록", PAUSED: "일시중지", SUCCESS: "성공", EMPTY: "재고 없음", FAILED: "실패", QUEUED: "대기", RUNNING: "진행 중", COMPLETED: "완료", CANCELLED: "취소", IDLE: "대기" };
function timestamp(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})
    .format(new Date(`${value.replace(" ","T")}Z`));
}
function duration(seconds: number | null): string {
  if (seconds == null) return "—";
  return [seconds >= 3600 ? `${Math.floor(seconds/3600)}시간` : "", seconds >= 60 ? `${Math.floor(seconds%3600/60)}분` : "", `${seconds%60}초`].filter(Boolean).join(" ");
}

const resolutionLabels = { PENDING: "미해결", RESOLVED: "해결됨", INELIGIBLE: "재고 조회 대상에서 제외" };
const modeLabels = { REPLACE_ALL: "전체 재고 갱신", APPEND_BOOK: "책별 재고 검색", REFRESH_SELECTED: "선택한 권 갱신" };

function RunSummary({ run }: { run: StockRefreshRun }) {
  return <>
    <div className={styles.heading}><h3>{run.mode ? modeLabels[run.mode] : "재고 검색"} · {run.status === "ARCHIVED" ? "오류 기록" : "총"} {run.total.toLocaleString("ko-KR")}권</h3>
      <span className={`status-badge status-${run.status.toLowerCase()}`}>{labels[run.status]}</span></div>
    <dl className={styles.timing}>
      <div><dt>시작시간 (KST)</dt><dd>{timestamp(run.startedAt)}</dd></div>
      <div><dt>종료시간 (KST)</dt><dd>{timestamp(run.finishedAt)}</dd></div>
      <div><dt>작업시간</dt><dd>{duration(run.durationSeconds)}</dd></div>
    </dl>
  </>;
}

export function StockRefreshLogs({ initial, runId }: { initial: Snapshot; runId?: string }) {
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
  const disabled = busy || active || progress.status === "PAUSED" || checking || unavailable;
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
        const response = await apiFetch(`/api/stock-refresh/logs?page=${page}${runId ? `&runId=${encodeURIComponent(runId)}` : ""}`, { cache: "no-store", signal: controller.signal }, { reportError: false });
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
  }, [runId, page, initialKey, revision, unavailable]);

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
        body: JSON.stringify(cancel ? { runId: progress.runId } : { volumeIds, runId }), signal: controller.signal
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

  const run = runId ? logs.runs[0] : null;
  const viewingCurrent = !runId || runId === progress.runId;
  const detailQuery = `runId=${encodeURIComponent(runId ?? "")}`;
  return <div className="stack-md">
    {viewingCurrent && <StockErrorNotice progress={progress}/>}
    {error && <p className="flash flash-error" role="alert">{error}</p>}
    {(busy || active || checking) && !unavailable && <ProgressIndicator label={checking ? "갱신 상태 확인 중" : "재고 갱신 중"}/>}
    {(active || progress.status === "PAUSED") && <div className="button-row"><span role="status">{progress.message}</span>
      {viewingCurrent && progress.runId && <button className="button button-danger-outline" disabled={busy || unavailable} onClick={() => void mutate(undefined, true)}>갱신 취소</button>}</div>}
    {!run ? <>
      <div className="section-heading"><h2>작업 기록</h2><span className="muted">{logs.total}건</span></div>
      {logs.runs.length ? logs.runs.map(item => <Link key={item.id} className={`panel ${styles.entry} ${styles.runLink}`}
        href={`/inventory/logs?runId=${encodeURIComponent(item.runId)}`} data-testid="stock-run-entry">
        <RunSummary run={item}/><span>작업 상세 보기 →</span>
      </Link>) : <div className="empty">아직 작업 기록이 없습니다.</div>}
      <Pagination page={logs.page} totalPages={logs.totalPages} label="작업 기록 페이지" href={target => `/inventory/logs?page=${target}`}/>
    </> : <>
      <section className={`panel ${styles.entry}`}>
        <RunSummary run={run}/>
        {run.processed != null && <div className="progress-stats"><span>처리 {run.processed}/{run.total}</span><span>성공 {run.success}</span><span>재고 없음 {run.empty}</span><span>실패 {run.fail}</span></div>}
        {run.message && <p className={run.status === "FAILED" ? styles.reason : "muted"}>{run.message}</p>}
        <div className="button-row">
          <button className="button" disabled={disabled || !logs.pendingFailures} onClick={() => void mutate()}>에러 일괄 재시도 ({logs.pendingFailures})</button>
          <a className="button button-secondary" download href={`/api/stock-refresh/logs?${detailQuery}&format=csv`}>CSV 다운로드</a>
          <a className="button button-secondary" download href={`/api/stock-refresh/logs?${detailQuery}&format=json`}>JSON 다운로드</a>
        </div>
      </section>
      <div className="section-heading"><h2>오류 내역 {logs.total}건</h2><span className="muted">미해결 실패 {logs.pendingFailures}권</span></div>
      {logs.items.length ? <>
      <div className="button-row"><button className="button button-secondary" disabled={disabled || !checked.length} onClick={() => void mutate(checked)}>선택 갱신 ({checked.length})</button></div>
      <label className={styles.select}><input type="checkbox" checked={eligible.length > 0 && checked.length === eligible.length} disabled={disabled || !eligible.length}
        onChange={event => setSelected(event.target.checked ? eligible : [])}/>이 페이지 전체 선택</label>
      <div className="stack-md">{logs.items.map(item => <article key={item.id} className={`panel ${styles.entry}`} data-testid="stock-log-entry">
        <div className={styles.heading}><div className={styles.select}><input type="checkbox" aria-label={`${item.volumeName} 로그 ${item.id} 선택`}
          checked={checked.includes(item.volumeId)} disabled={disabled || !item.retryable} onChange={() => toggle(item.volumeId)}/>{item.bookExists ? <BookDetailLink bookId={item.bookId}>{item.bookName}</BookDetailLink> : item.bookName}</div>
          <span className={`status-badge ${item.retryable ? "status-failed" : "status-completed"}`}>{resolutionLabels[item.resolution ?? "PENDING"]}</span></div>
        <h3>{item.volumeName}{item.volume != null && <span className="muted"> · {item.volume}권</span>}</h3>
        <p className="muted">ISBN {item.isbn13 || "미등록"} · {item.createdAt} UTC</p>
        <p className={styles.reason}>{item.message}</p>
        <div className={styles.footer}><code>{item.code}</code><div className="button-row">
          {item.currentIsbn && <Link className="button button-secondary" href={`/aladin/used?isbn=${encodeURIComponent(item.currentIsbn)}`}>재고 직접 검색</Link>}
          <button className="button button-secondary" disabled={disabled || !item.retryable}
          onClick={() => void mutate([item.volumeId])}>개별 갱신</button></div></div>
      </article>)}</div>
      <Pagination page={logs.page} totalPages={logs.totalPages} label="오류 내역 페이지" href={target => `/inventory/logs?${detailQuery}&page=${target}`}/>
    </> : <div className="empty">이 작업에 저장된 권별 오류가 없습니다.</div>}
    </>}
  </div>;
}
