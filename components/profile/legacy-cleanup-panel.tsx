"use client";

import { apiFetch } from "@/lib/api-fetch";

import { useEffect, useRef, useState } from "react";
import type { CleanupStatus } from "@/features/migration/types";

async function responseStatus(response: Response): Promise<CleanupStatus> {
  const value = await response.json().catch(() => null) as Partial<CleanupStatus> | null;
  if (!response.ok) throw new Error(typeof value?.message === "string" ? value.message : "원본 상태 요청에 실패했습니다. 다시 확인해 주세요.");
  if (!value || !["READY", "BLOCKED", "CLEANED", "NOT_FOUND", "RETRY"].includes(value.state ?? "")
      || typeof value.canDelete !== "boolean" || typeof value.message !== "string" || !value.message.trim()
      || ![value.databaseBytes, value.coverBytes, value.coverFiles].every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)) {
    throw new Error("원본 상태 응답을 확인할 수 없습니다. 다시 확인해 주세요.");
  }
  return value as CleanupStatus;
}

export function LegacyCleanupPanel({ initialStatus }: { initialStatus: CleanupStatus }) {
  const [status, setStatus] = useState<CleanupStatus | null>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setStatus(initialStatus);
    setMessage("");
  }, [initialStatus]);
  useEffect(() => () => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.abort();
  }, []);

  async function refresh() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setChecking(true); setMessage("");
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await apiFetch("/api/migration/legacy-cleanup", { cache: "no-store", signal: controller.signal });
      const value = await responseStatus(response);
      if (requestRef.current === controller && !controller.signal.aborted) setStatus(value);
    } catch (error) {
      if (requestRef.current === controller) {
        setStatus(null);
        setMessage(controller.signal.aborted ? "원본 상태 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요."
          : error instanceof Error ? error.message : "원본 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
      }
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === controller) { requestRef.current = null; setChecking(false); }
    }
  }
  async function remove() {
    if (!window.confirm("Java에서 쓰던 원본 DB와 표지를 삭제합니까? 새 책장 데이터와 이전 전 DB 백업은 유지됩니다.")) return;
    setBusy(true); setMessage("이전본·백업·표지를 확인하고 원본을 정리하고 있습니다.");
    try {
      const response = await apiFetch("/api/migration/legacy-cleanup", { method: "POST" });
      const value = await responseStatus(response);
      setStatus(value); setMessage("");
    } catch (error) { setStatus(null); setMessage(error instanceof Error ? error.message : "원본 데이터를 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="panel stack-md"><div><p className="eyebrow">Migration</p><h2>기존 데이터 정리</h2>
    <p className="muted">이전 완료 후 Java 원본 DB와 표지만 삭제합니다. 새 책장과 기존 백업·로그는 유지됩니다. 먼저 기존 Spring을 종료하세요.</p></div>
    {status?.state === "READY" && <p className="muted">DB {(status.databaseBytes / 1024 ** 2).toFixed(2)} MiB · 표지 {status.coverFiles.toLocaleString("ko-KR")}개 ({(status.coverBytes / 1024 ** 2).toFixed(2)} MiB)</p>}
    <p role="status" aria-live="polite">{message || (checking ? "원본 데이터 상태를 확인하고 있습니다." : status?.message) || "원본 상태를 다시 확인해 주세요."}</p>
    <div className="button-row">
      <button type="button" className="button button-secondary" disabled={busy || checking} onClick={refresh}>{checking ? "상태 확인 중" : "상태 다시 확인"}</button>
      <button type="button" className="button button-danger" disabled={busy || checking || !status?.canDelete || !["READY", "RETRY"].includes(status.state)} onClick={remove}>{busy ? "원본 정리 중" : status?.state === "CLEANED" ? "원본 삭제 완료" : status?.state === "NOT_FOUND" ? "삭제할 원본 없음" : "기존 DB·표지 삭제"}</button>
    </div>
  </section>;
}
