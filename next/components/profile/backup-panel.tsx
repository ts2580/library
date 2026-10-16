"use client";

import { useEffect, useRef, useState } from "react";

const CHUNK = 8 * 1024 * 1024;
const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024;

type UploadStatus = {
  status: "UPLOADING" | "ASSEMBLING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  message: string | null;
  percent: number;
  completed: boolean;
};

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "요청을 처리하지 못했습니다.");
  return body;
}

export function BackupPanel() {
  const [message, setMessage] = useState("");
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function stopPolling(): void {
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  useEffect(() => stopPolling, []);

  async function pollStatus(uploadId: string): Promise<void> {
    stopPolling();
    const check = async (): Promise<boolean> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(`/api/backup/covers/uploads/${uploadId}/status`, {
          cache: "no-store",
          signal: controller.signal
        });
        const status = await responseBody<UploadStatus>(response);
        setMessage(status.message ?? "표지 ZIP 작업 상태를 확인하고 있습니다.");
        setPercent(status.percent);
        if (status.completed || status.status === "FAILED") {
          stopPolling();
          setBusy(false);
          return true;
        }
        return false;
      } catch (error) {
        if (controller.signal.aborted) return true;
        stopPolling();
        setMessage(error instanceof Error ? error.message : "작업 상태를 확인하지 못했습니다.");
        setBusy(false);
        return true;
      }
    };
    const terminal = await check();
    if (!terminal) timerRef.current = window.setInterval(() => void check(), 1500);
  }

  async function uploadArchive(file: File): Promise<void> {
    stopPolling();
    setBusy(true);
    setPercent(0);
    setMessage("업로드 준비 중");
    try {
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("ZIP 파일만 업로드할 수 있습니다.");
      if (file.size <= 0 || file.size > MAX_ARCHIVE_SIZE) throw new Error("표지 ZIP은 2GiB 이하여야 합니다.");

      const totalChunks = Math.ceil(file.size / CHUNK);
      const create = await fetch("/api/backup/covers/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, totalSize: file.size, totalChunks })
      });
      const created = await responseBody<{ uploadId: string }>(create);

      for (let index = 0; index < totalChunks; index += 1) {
        const part = file.slice(index * CHUNK, Math.min(file.size, (index + 1) * CHUNK));
        const response = await fetch(`/api/backup/covers/uploads/${created.uploadId}/chunks/${index}`, {
          method: "PUT",
          body: part
        });
        await responseBody(response);
        setPercent(Math.round((index + 1) * 100 / totalChunks));
        setMessage(`청크 ${index + 1}/${totalChunks} 업로드`);
      }

      const complete = await fetch(`/api/backup/covers/uploads/${created.uploadId}/complete`, { method: "POST" });
      await responseBody(complete);
      setMessage("복원 작업 대기 중");
      await pollStatus(created.uploadId);
    } catch (error) {
      stopPolling();
      setMessage(error instanceof Error ? error.message : "표지 ZIP 업로드에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <section className="panel stack-md">
      <div className="section-heading"><div><p className="eyebrow">Backup</p><h2>데이터 백업</h2></div></div>
      <div className="backup-grid">
        <div className="backup-item"><h3>엑셀</h3><p>현재 계정의 도서와 권 데이터를 내보내거나 병합 가져오기합니다.</p><div className="button-row"><a className="button button-secondary" href="/api/backup/excel/export">엑셀 다운로드</a><form action="/api/backup/excel/import" method="post" encType="multipart/form-data"><label className="button button-outline">엑셀 업로드<input type="file" name="backupFile" accept=".xlsx" hidden onChange={(event) => event.currentTarget.form?.requestSubmit()}/></label></form></div></div>
        <div className="backup-item"><h3>표지 ZIP</h3><p>런타임 표지를 별도 보관합니다. 최대 2GiB, 8MiB 청크로 전송합니다.</p><div className="button-row"><a className="button button-secondary" href="/api/backup/covers/export">표지 다운로드</a><label className={`button button-outline ${busy ? "is-disabled" : ""}`}>표지 업로드<input type="file" accept=".zip" hidden disabled={busy} onChange={(event) => { const selected = event.target.files?.[0]; event.currentTarget.value = ""; if (selected) void uploadArchive(selected); }}/></label></div></div>
      </div>
      {(message || busy) && <div className="stack-sm" role="status" aria-live="polite"><div className="progress-track"><div style={{ width: `${percent}%` }}/></div><p className="muted">{message}</p></div>}
    </section>
  );
}
