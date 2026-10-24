"use client";

import { apiFetch } from "@/lib/api-fetch";
import { reportClientError } from "@/lib/client-errors";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CHUNK = 8 * 1024 * 1024;
const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024;
const ACTIVE_JOB_KEY = "bookshelf.cover-restore-job";
type Phase = "IDLE" | "UPLOADING" | "ASSEMBLING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
type UploadStatus = { status: Exclude<Phase, "IDLE">; message: string | null; percent: number; completed: boolean; uploadedChunks: number; totalChunks: number };
const phaseLabels: Record<Phase, string> = {
  IDLE: "", UPLOADING: "업로드", ASSEMBLING: "ZIP 조립", QUEUED: "복원 대기",
  PROCESSING: "검사·복원", COMPLETED: "복원 완료", FAILED: "작업 실패"
};

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new RequestError(body.message ?? "요청을 처리하지 못했습니다.", response.status);
  return body;
}

function rememberJob(uploadId: string | null): void {
  try {
    if (uploadId) sessionStorage.setItem(ACTIVE_JOB_KEY, uploadId);
    else sessionStorage.removeItem(ACTIVE_JOB_KEY);
  } catch { /* Storage may be unavailable; in-page status checking still works. */ }
}

export function BackupPanel() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const pollRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const excelInput = useRef<HTMLInputElement | null>(null);
  const archiveInput = useRef<HTMLInputElement | null>(null);

  function stopPolling(): void {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    pollRef.current?.abort();
    pollRef.current = null;
  }

  function pollStatus(uploadId: string): void {
    stopPolling();
    const controller = new AbortController();
    pollRef.current = controller;
    let failures = 0;
    setBusy(true);
    const check = async (): Promise<void> => {
      let retry = true;
      try {
        const response = await apiFetch(`/api/backup/covers/uploads/${uploadId}/status`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
        });
        const status = await responseBody<UploadStatus>(response);
        if (!mounted.current || controller.signal.aborted) return;
        if (status.status === "UPLOADING" && status.totalChunks > 0 && status.uploadedChunks === status.totalChunks) {
          // Recover a refresh between the last chunk and the idempotent complete request.
          setPhase("ASSEMBLING");
          setMessage("업로드가 완료된 ZIP의 조립을 요청합니다.");
          await responseBody(await apiFetch(`/api/backup/covers/uploads/${uploadId}/complete`, {
            method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
          }, { deduplicate: true }));
          failures = 0;
          return;
        }
        failures = 0;
        setPhase(status.status);
        setMessage(status.message ?? "표지 ZIP 작업 상태를 확인하고 있습니다.");
        if (status.status === "FAILED") reportClientError({ code: "COVER_RESTORE_FAILED", message: status.message ?? "표지 복원에 실패했습니다.", source: "cover-worker" });
        if (status.status === "UPLOADING") setPercent(status.percent);
        if (status.completed || status.status === "FAILED") {
          retry = false;
          rememberJob(null);
          setJobId(null);
          setBusy(false);
          if (status.completed) { setPercent(100); router.refresh(); }
        }
      } catch (error) {
        if (!mounted.current || controller.signal.aborted) return;
        failures += 1;
        const inaccessible = error instanceof RequestError && [401, 403, 404].includes(error.status);
        retry = !inaccessible && failures < 3;
        if (inaccessible) { rememberJob(null); setJobId(null); }
        setMessage(retry ? "상태 조회가 지연되어 다시 확인합니다. 서버 작업은 계속 진행됩니다."
          : "작업 상태를 확인하지 못했습니다. 로그인과 연결 상태를 확인한 뒤 다시 확인해 주세요.");
        if (!retry) setBusy(false);
      } finally {
        // Schedule AFTER the response. Slow responses are not cancelled every 1.5s.
        if (retry && mounted.current && !controller.signal.aborted) {
          timerRef.current = window.setTimeout(() => void check(), 1500 * 2 ** failures);
        } else if (pollRef.current === controller) {
          pollRef.current = null;
        }
      }
    };
    void check();
  }

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = sessionStorage.getItem(ACTIVE_JOB_KEY);
      if (saved) { setJobId(saved); setPhase("QUEUED"); pollStatus(saved); }
    } catch { /* Resume is optional when session storage is disabled. */ }
    return () => {
      mounted.current = false;
      stopPolling();
      uploadRef.current?.abort();
    };
  }, []);

  async function uploadArchive(file: File): Promise<void> {
    stopPolling();
    const controller = new AbortController();
    uploadRef.current?.abort();
    uploadRef.current = controller;
    setBusy(true);
    setPercent(0);
    setPhase("UPLOADING");
    setMessage("업로드 준비 중");
    let acceptedJob: string | null = null;
    try {
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("ZIP 파일만 업로드할 수 있습니다.");
      if (file.size <= 0 || file.size > MAX_ARCHIVE_SIZE) throw new Error("표지 ZIP은 2GiB 이하여야 합니다.");
      const totalChunks = Math.ceil(file.size / CHUNK);
      const create = await apiFetch("/api/backup/covers/uploads", {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, totalSize: file.size, totalChunks })
      });
      const created = await responseBody<{ uploadId: string }>(create);
      if (!mounted.current || controller.signal.aborted) return;
      setJobId(created.uploadId);
      for (let index = 0; index < totalChunks; index += 1) {
        const part = file.slice(index * CHUNK, Math.min(file.size, (index + 1) * CHUNK));
        const response = await apiFetch(`/api/backup/covers/uploads/${created.uploadId}/chunks/${index}`, {
          method: "PUT", body: part, signal: controller.signal
        });
        await responseBody(response);
        if (!mounted.current || controller.signal.aborted) return;
        setPercent(Math.round((index + 1) * 100 / totalChunks));
        setMessage(`청크 ${index + 1}/${totalChunks} 전송 완료`);
      }
      // From this point a refresh can recover status without uploading again.
      acceptedJob = created.uploadId;
      rememberJob(acceptedJob);
      setPhase("ASSEMBLING");
      setMessage("업로드가 끝났습니다. ZIP 조립 후 복원을 시작합니다.");
      const complete = await apiFetch(`/api/backup/covers/uploads/${acceptedJob}/complete`, {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
      });
      await responseBody(complete);
      if (mounted.current && !controller.signal.aborted) pollStatus(acceptedJob);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (acceptedJob) {
        // An interrupted response does not prove that server-side assembly failed.
        pollStatus(acceptedJob);
      } else {
        setPhase("FAILED");
        setMessage(error instanceof Error ? error.message : "표지 ZIP 업로드에 실패했습니다.");
        setJobId(null);
        setBusy(false);
      }
    } finally {
      if (uploadRef.current === controller) uploadRef.current = null;
    }
  }

  const determinate = phase === "UPLOADING" || phase === "COMPLETED";
  return (
    <section className="panel stack-md">
      <div className="section-heading"><h2>데이터 백업</h2></div>
      <div className="backup-grid">
        <div className="backup-item">
          <h3>엑셀</h3><p>현재 계정의 도서와 권 데이터를 내보내거나 병합 가져오기합니다.</p>
          <div className="button-row">
            <a className="button button-secondary" href="/api/backup/excel/export">엑셀 다운로드</a>
            <form action="/api/backup/excel/import" method="post" encType="multipart/form-data">
              <input ref={excelInput} type="file" name="backupFile" accept=".xlsx" hidden
                onChange={(event) => { if (event.currentTarget.files?.length) event.currentTarget.form?.requestSubmit(); }}/>
              <button type="button" className="button button-outline" onClick={() => excelInput.current?.click()}>엑셀 업로드</button>
            </form>
          </div>
        </div>
        <div className="backup-item">
          <h3>표지 ZIP</h3><p>최대 2GiB, 8MiB 청크로 전송합니다. 전송 이후 검사·복원이 별도로 진행됩니다.</p>
          <div className="button-row">
            <a className="button button-secondary" href="/api/backup/covers/export">표지 다운로드</a>
            <input ref={archiveInput} type="file" accept=".zip" hidden disabled={busy}
              onChange={(event) => { const selected = event.target.files?.[0]; event.currentTarget.value = ""; if (selected) void uploadArchive(selected); }}/>
            <button type="button" className="button button-outline" disabled={busy}
              onClick={() => archiveInput.current?.click()}>표지 업로드</button>
          </div>
        </div>
      </div>
      {(message || busy) && <div className="stack-sm" role="status" aria-live="polite">
        <strong>{phaseLabels[phase]}{phase === "UPLOADING" ? ` ${percent}%` : ""}</strong>
        {busy && <progress style={{ width: "100%" }} max={100}
          value={determinate ? percent : undefined} aria-label={phaseLabels[phase]}/>}
        <p className="muted">{message}</p>
        {phase === "QUEUED" && <p className="muted small">대기가 계속되면 서버의 별도 워커 실행 상태를 확인해 주세요.</p>}
      </div>}
      {jobId && !busy && <button type="button" className="button button-outline" onClick={() => pollStatus(jobId)}>작업 상태 다시 확인</button>}
    </section>
  );
}
