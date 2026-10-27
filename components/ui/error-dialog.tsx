"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { clearReportedError, currentError, dismissClientError, reportClientError, sanitizedErrorDetails, serverErrorSnapshot, subscribeErrors } from "@/lib/client-errors";

export function ErrorReporter({ message, code = "REQUEST_FAILED", source = "page", eventId }: { message?: string | null; code?: string; source?: string; eventId?: string }) {
  useEffect(() => {
    if (!message) { clearReportedError(source); return; }
    const query = new URLSearchParams(window.location.search);
    const suppliedCode = query.get("error") === message ? query.get("errorCode") : null;
    reportClientError({ message, code: suppliedCode || code, source, eventId });
    return () => clearReportedError(source);
  }, [message, code, source, eventId]);
  return null;
}

export function ErrorDialog() {
  const error = useSyncExternalStore(subscribeErrors, currentError, serverErrorSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [copied, setCopied] = useState("");
  useEffect(() => {
    setCopied("");
    if (error && dialog.current) {
      if (!dialog.current.open) dialog.current.showModal();
      confirm.current?.focus();
    }
    if (!error && dialog.current?.open) dialog.current.close();
  }, [error]);
  function close() {
    if (error) dismissClientError(error);
    dialog.current?.close();
  }
  return <dialog ref={dialog} role="alertdialog" className="error-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`}
    onCancel={event => { event.preventDefault(); close(); }}>
    {error && <div className="stack-md">
      <div><p className="eyebrow">오류 안내</p><h2 id={`${id}-title`}>요청을 처리하지 못했습니다</h2></div>
      <p id={`${id}-message`}>{error.message}</p>
      <div className="error-dialog-code"><span>오류 코드</span><code>{error.code}</code>{error.status != null && <span>HTTP {error.status}</span>}</div>
      <p className="muted small">{error.code === "UNAUTHORIZED" || error.status === 401 ? "다시 로그인한 뒤 작업 상태를 확인해 주세요."
        : error.code === "FORBIDDEN" || error.status === 403 ? "현재 계정의 접근 권한을 확인해 주세요."
        : "오류가 반복되면 상세 내용을 복사해 문의해 주세요."}</p>
      <details><summary>오류 상세</summary><pre className="error-dialog-details">{sanitizedErrorDetails(error)}</pre></details>
      {copied && <p className="muted small" role="status">{copied}</p>}
      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(sanitizedErrorDetails(error)); setCopied("상세 오류를 복사했습니다."); }
          catch { setCopied("복사하지 못했습니다. 오류 상세를 펼쳐 직접 복사해 주세요."); }
        }}>상세 복사</button>
        <button ref={confirm} type="button" className="button" onClick={close}>확인</button>
      </div>
    </div>}
  </dialog>;
}
