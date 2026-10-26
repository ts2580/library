"use client";

import { apiFetch } from "@/lib/api-fetch";
import { ErrorReporter } from "@/components/ui/error-dialog";
import { clearReportedError, reportClientError } from "@/lib/client-errors";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProgressIndicator } from "@/components/ui/top-progress";
import type { StockRefreshProgress } from "@/features/inventory/types";

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "요청을 처리하지 못했습니다.");
  return body;
}

export function StockRefreshPanel({ initial }: { initial: StockRefreshProgress }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [busy, setBusy] = useState<"POST" | "PATCH" | "DELETE" | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [stalled, setStalled] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const active = progress.status === "QUEUED" || progress.status === "RUNNING";
  const previousProgress = useRef(progress);
  const initialKey = JSON.stringify(initial);
  const previousInitial = useRef(initialKey);
  const revision = useRef(0);

  useEffect(() => {
    const previous = previousProgress.current;
    const wasActive = previous.status === "QUEUED" || previous.status === "RUNNING";
    const completionChanged = progress.completionId && progress.completionId !== previous.completionId;
    if ((wasActive && !active) || completionChanged) router.refresh();
    previousProgress.current = progress;
  }, [active, progress, router]);

  useEffect(() => {
    setStalled("");
    if (!active || unavailable) return;
    const delay = progress.status === "QUEUED" ? 60_000 : 120_000;
    const updatedAt = progress.updatedAt ? Date.parse(progress.updatedAt.replace(" ", "T") + "Z") : NaN;
    const remaining = Number.isFinite(updatedAt) ? Math.max(0, delay - (Date.now() - updatedAt)) : delay;
    const timer = setTimeout(() => {
      const message = progress.status === "QUEUED"
        ? "재고 갱신이 1분 이상 대기 중입니다. 워커가 동작하는지 확인하거나 갱신을 취소해 주세요."
        : "재고 갱신 진행 상태가 2분 이상 바뀌지 않았습니다. 잠시 더 기다리거나 갱신을 취소해 주세요.";
      setStalled(message);
      reportClientError({ code: "STOCK_REFRESH_STALLED", message, source: "stock-worker-stalled" });
    }, remaining);
    return () => { clearTimeout(timer); clearReportedError("stock-worker-stalled"); };
  }, [active, progress.status, progress.runId, progress.updatedAt, unavailable]);

  useEffect(() => {
    const changed = previousInitial.current !== initialKey;
    previousInitial.current = initialKey;
    if ((!active && !checking && (!changed || initialKey === JSON.stringify(progress))) || unavailable) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let stopped = false;
    const refresh = async () => {
      if (controller.signal.aborted || stopped || request) return;
      clearTimeout(timer);
      const currentRequest = new AbortController();
      request = currentRequest;
      const requestRevision = revision.current;
      const abort = () => currentRequest.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 10_000);
      try {
        const response = await apiFetch("/api/stock-refresh", { cache: "no-store", signal: currentRequest.signal });
        if (controller.signal.aborted || requestRevision !== revision.current) return;
        if ([401, 403].includes(response.status)) {
          stopped = true;
          setUnavailable(true);
          setError("로그인 또는 접근 권한을 확인할 수 없어 재고 상태 조회를 중단했습니다. 다시 로그인해 주세요.");
          return;
        }
        const body = await responseBody<StockRefreshProgress>(response);
        if (controller.signal.aborted || currentRequest.signal.aborted || requestRevision !== revision.current) return;
        stopped = body.status !== "QUEUED" && body.status !== "RUNNING";
        setProgress(body);
        setChecking(false);
        setError("");
      } catch (cause) {
        if (controller.signal.aborted || requestRevision !== revision.current) return;
        if (currentRequest.signal.aborted) reportClientError({ code: "CLIENT_TIMEOUT", message: "재고 상태 조회 시간이 초과되었습니다. 다시 시도합니다.", source: "GET /api/stock-refresh" });
        else if (cause instanceof SyntaxError) reportClientError({ code: "INVALID_RESPONSE", message: "재고 상태 응답을 읽지 못했습니다. 다시 시도합니다.", source: "GET /api/stock-refresh" });
        setError(currentRequest.signal.aborted ? "재고 상태 조회 시간이 초과되었습니다. 다시 시도합니다."
          : cause instanceof Error ? cause.message : "진행 상태를 확인하지 못했습니다.");
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abort);
        request = undefined;
        if (!controller.signal.aborted && !stopped) timer = setTimeout(() => void refresh(), 1500);
      }
    };
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    // Re-read new server props instead of overwriting a newer local job response.
    timer = setTimeout(() => void refresh(), changed ? 0 : 1500);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [active, checking, initialKey, unavailable]);

  async function mutate(method: "POST" | "PATCH" | "DELETE"): Promise<void> {
    if (busy) return;
    revision.current++;
    setBusy(method);
    setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const source = `${method} /api/stock-refresh`;
    clearReportedError(source);
    let code = "STOCK_REFRESH_REQUEST_FAILED";
    let status: number | undefined;
    try {
      const response = await apiFetch("/api/stock-refresh", {
        method, signal: controller.signal,
        ...(method === "PATCH" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: progress.runId }) } : {})
      }, { reportError: false });
      status = response.status;
      const body = await response.json() as { progress?: StockRefreshProgress; code?: string; message?: string };
      if (body.progress) setProgress(body.progress);
      if (!response.ok) {
        code = body.code ?? `HTTP_${response.status}`;
        throw new Error(body.message ?? "재고 갱신 요청을 처리하지 못했습니다.");
      }
      if (!body.progress) throw new Error("재고 갱신 상태가 응답에 없습니다.");
      setChecking(false);
      if (method === "DELETE") window.location.reload();
    } catch (cause) {
      const message = controller.signal.aborted
        ? "재고 갱신 요청 시간이 초과되었습니다. 서버의 처리 여부를 다시 확인합니다."
        : cause instanceof Error ? cause.message : "재고 갱신 요청을 처리하지 못했습니다.";
      setError(message);
      reportClientError({ code: controller.signal.aborted ? "CLIENT_TIMEOUT" : code, message, status, source });
      setChecking(true);
    } finally {
      clearTimeout(timeout);
      setBusy(null);
    }
  }

  function clearInventory(): void {
    if (!window.confirm("현재 계정의 지점 재고를 모두 삭제합니까?")) return;
    void mutate("DELETE");
  }

  return (
    <section className="panel stack-md" aria-labelledby="stock-refresh-title">
      <div className="section-heading"><div><p className="eyebrow">Background worker</p><h2 id="stock-refresh-title">중고 재고 일괄 갱신</h2></div><span className={`status-badge status-${progress.status.toLowerCase()}`}>{progress.status}</span></div>
      <p className="muted" aria-live="polite">{progress.message}</p>
      {error && <p className="flash flash-error" role="alert">{error}</p>}
      {stalled && <p className="flash flash-error" role="alert">{stalled}</p>}
      <ErrorReporter message={progress.status === "FAILED" || (progress.status === "COMPLETED" && progress.fail > 0) ? progress.message : null} code={progress.status === "FAILED" ? "STOCK_REFRESH_FAILED" : "STOCK_REFRESH_PARTIAL_FAILURE"} source="stock-worker"/>
      {(busy || active || checking) && !unavailable && <ProgressIndicator label={progress.status === "QUEUED" ? "워커 처리 대기 중" : "재고 갱신 중"}/>}
      <div className="progress-track" aria-label={`진행률 ${progress.percent}%`}><div style={{ width: `${progress.percent}%` }}/></div>
      <div className="progress-stats"><span>{progress.processed}/{progress.total}</span><span>성공 {progress.success}</span><span>재고없음 {progress.empty}</span><span>실패 {progress.fail}</span></div>
      <div className="button-row stock-refresh-actions">
        <button className="button button-danger-outline" type="button" onClick={clearInventory} disabled={Boolean(busy) || active || checking || unavailable}>전체 삭제</button>
        {active && progress.runId !== undefined && <button className="button button-danger-outline" type="button" onClick={() => void mutate("PATCH")} disabled={Boolean(busy) || unavailable}>{busy === "PATCH" ? "취소 중…" : "갱신 취소"}</button>}
        <button className="button" type="button" onClick={() => void mutate("POST")} disabled={Boolean(busy) || active || checking || unavailable}>{unavailable ? "상태 확인 불가" : active ? "진행 중" : "갱신 시작"}</button>
      </div>
    </section>
  );
}
