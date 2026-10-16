"use client";

import { useEffect, useState } from "react";
import type { CleanupStatus } from "@/features/migration/types";

export function LegacyCleanupPanel() {
  const [status, setStatus] = useState<CleanupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/migration/legacy-cleanup", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.message); setStatus(value); })
      .catch((error) => { if (!controller.signal.aborted) setMessage(error.message || "원본 상태를 확인하지 못했습니다."); });
    return () => controller.abort();
  }, []);
  async function remove() {
    if (!window.confirm("Java에서 쓰던 원본 DB와 표지를 삭제합니까? 새 책장 데이터와 이전 전 DB 백업은 유지됩니다.")) return;
    setBusy(true); setMessage("이전본·백업·표지를 확인하고 원본을 정리하고 있습니다.");
    try {
      const response = await fetch("/api/migration/legacy-cleanup", { method: "POST" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message || "원본 데이터를 삭제하지 못했습니다.");
      setStatus(value); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "원본 데이터를 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="panel stack-md"><div><p className="eyebrow">Migration</p><h2>기존 데이터 정리</h2>
    <p className="muted">이전 완료 후 Java 원본 DB와 표지만 삭제합니다. 새 책장과 기존 백업·로그는 유지됩니다. 먼저 기존 Spring을 종료하세요.</p></div>
    {status?.state === "READY" && <p className="muted">DB {(status.databaseBytes / 1024 ** 2).toFixed(2)} MiB · 표지 {status.coverFiles.toLocaleString("ko-KR")}개 ({(status.coverBytes / 1024 ** 2).toFixed(2)} MiB)</p>}
    <p role="status" aria-live="polite">{message || status?.message || "원본 데이터 상태를 확인하고 있습니다."}</p>
    <div><button type="button" className="button button-danger" disabled={busy || !status?.canDelete} onClick={remove}>{busy ? "원본 정리 중" : status?.state === "CLEANED" ? "원본 삭제 완료" : "기존 DB·표지 삭제"}</button></div>
  </section>;
}
