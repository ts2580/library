"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { showToast } from "@/components/ui/toast";
import { ProgressIndicator } from "@/components/ui/top-progress";
import type { MetadataEnrichmentProgress } from "@/features/books/enrichment-types";

const isActive = (progress: MetadataEnrichmentProgress | null) => progress?.status === "QUEUED" || progress?.status === "RUNNING";

export function MetadataEnrichmentPanel({ initial }: { initial: MetadataEnrichmentProgress | null }) {
  const [progress, setProgress] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const previous = useRef(initial);
  const startRequest = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const active = isActive(progress);

  function accept(next: MetadataEnrichmentProgress | null) {
    const before = previous.current;
    if (next?.status === "COMPLETED" && (isActive(before) || next.runId !== before?.runId)) showToast(next.message);
    previous.current = next;
    setProgress(next);
  }

  useEffect(() => () => startRequest.current?.abort(), []);
  useEffect(() => {
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | null = null;
    async function poll() {
      if (request || lifetime.signal.aborted || unavailable) return;
      clearTimeout(timer);
      const controller = new AbortController(); request = controller;
      const requestRevision = revision.current;
      const abort = () => controller.abort();
      lifetime.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 10_000);
      let retry = active || checking;
      try {
        const response = await apiFetch("/api/books/enrich", { cache: "no-store", signal: controller.signal }, { reportError: false });
        if ([401, 403].includes(response.status)) { setUnavailable(true); throw new Error("로그인 상태를 확인한 뒤 다시 열어 주세요."); }
        if (!response.ok) throw new Error("정보 보강 상태를 확인하지 못했습니다. 다시 확인합니다.");
        const body = await response.json() as { progress: MetadataEnrichmentProgress | null };
        if (lifetime.signal.aborted || requestRevision !== revision.current) return;
        accept(body.progress); setChecking(false); setError(""); retry = isActive(body.progress);
      } catch (cause) {
        if (!lifetime.signal.aborted) setError(cause instanceof Error && !controller.signal.aborted ? cause.message : "상태 조회가 지연되고 있습니다. 다시 확인합니다.");
      } finally {
        clearTimeout(timeout); lifetime.signal.removeEventListener("abort", abort); request = null;
        if (retry && !lifetime.signal.aborted) timer = setTimeout(() => void poll(), 1500);
      }
    }
    const wake = () => { if (document.visibilityState === "visible") void poll(); };
    if (active || checking) timer = setTimeout(() => void poll(), 1000);
    window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
    return () => { lifetime.abort(); clearTimeout(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [active, checking, progress?.runId, unavailable]);

  async function start() {
    if (busy || active || startRequest.current) return;
    revision.current++;
    setBusy(true); setError("");
    const controller = new AbortController(); startRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await apiFetch("/api/books/enrich", { method: "POST", signal: controller.signal });
      const body = await response.json() as { progress?: MetadataEnrichmentProgress; message?: string };
      if (!response.ok || !body.progress) throw new Error(body.message ?? "정보 보강을 요청하지 못했습니다.");
      accept(body.progress);
    } catch (cause) {
      setError(controller.signal.aborted ? "요청 응답이 지연되어 진행 상태를 다시 확인합니다." : cause instanceof Error ? cause.message : "정보 보강을 요청하지 못했습니다.");
      setChecking(true);
    } finally { clearTimeout(timeout); startRequest.current = null; setBusy(false); }
  }

  return <section className="panel stack-md" aria-labelledby="metadata-enrichment-title">
    <div><p className="eyebrow">Book metadata</p><h2 id="metadata-enrichment-title">전체 책 정보 보강</h2>
      <p className="muted">내 책장의 모든 책과 권에서 비어 있는 저자·설명을 알라딘에서 찾아 채웁니다. 입력된 내용은 유지하며, 페이지를 닫아도 작업은 계속됩니다.</p></div>
    <button type="button" className="button button-outline" disabled={busy || active || checking || unavailable} onClick={() => void start()}>
      {busy ? "요청 중" : active ? "전체 정보 보강 중" : "전체 책 저자·설명 채우기"}</button>
    {(busy || active || checking) && !unavailable && <ProgressIndicator label={progress?.status === "QUEUED" ? "정보 보강 대기 중" : "책 정보 보강 중"}/>}
    {error && <p className="flash flash-error" role="alert">{error}</p>}
    {active && <p className="muted" role="status">{progress?.message}</p>}
    {progress && <div className="progress-stats"><span>확인 {progress.processed}/{progress.total}책</span><span>책 보강 {progress.booksUpdated}</span><span>권 보강 {progress.volumesUpdated}</span><span>변경 없음 {progress.skipped}</span><span>실패 {progress.failed}</span></div>}
  </section>;
}
