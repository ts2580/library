"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import type { BookDetail, VolumeSaveResult } from "@/features/books/types";
import { SubmitButton } from "@/components/ui/submit-button";
import { CategorySelect } from "@/components/books/category-select";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { showToast } from "@/components/ui/toast";
import { clearReportedError, reportClientError } from "@/lib/client-errors";

export function BookForm({
  action,
  saveAction,
  book,
  categories = [],
  submitLabel = "저장",
  deleteAction,
  enrichAction,
  returnTo
}: {
  action: (formData: FormData) => void | Promise<void>;
  saveAction?: (formData: FormData) => Promise<VolumeSaveResult>;
  book?: BookDetail | null;
  categories?: string[];
  submitLabel?: string;
  deleteAction?: (formData: FormData) => void | Promise<void>;
  enrichAction?: (formData: FormData) => void | Promise<void>;
  returnTo?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    if (!saveAction) return;
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const source = `book-save:${book?.id ?? "new"}`;
    clearReportedError(source); setError("");
    startSaving(async () => {
      try {
        const result = await saveAction(data);
        if (!result.success) {
          setError(result.message); reportClientError({ code: result.code ?? "BOOK_SAVE_FAILED", message: result.message, source }); return;
        }
        form.current?.closest<HTMLDialogElement>("dialog")?.close();
        showToast(result.message);
      } catch {
        const message = "책 정보를 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
        setError(message); reportClientError({ code: "NETWORK_ERROR", message, source });
      }
    });
  }
  return (
    <div className="entity-edit-layout entity-edit-layout-book">
    <form ref={form} action={action} onSubmit={saveAction ? save : undefined} className="entity-edit-form book-edit-form" aria-label="책 정보">
      <div className="form-grid entity-edit-fields">
      {error && <p className="flash flash-error span-2" role="alert">{error}</p>}
      {book && <input type="hidden" name="bookId" value={book.id}/>}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo}/>}
      <div className="field"><label htmlFor={`book-name-${book?.id ?? "new"}`}>제목</label><input className="input" id={`book-name-${book?.id ?? "new"}`} name="name" defaultValue={book?.name ?? ""} maxLength={300} required/></div>
      <div className="field"><label htmlFor={`book-author-${book?.id ?? "new"}`}>저자</label><input className="input" id={`book-author-${book?.id ?? "new"}`} name="author" defaultValue={book?.author ?? ""} maxLength={300}/></div>
      <CategorySelect id={`book-type-${book?.id ?? "new"}`} categories={categories} initialValue={book?.type ?? ""}/>
      <div className="field"><label htmlFor={`book-total-${book?.id ?? "new"}`}>총 권수</label><input className="input" id={`book-total-${book?.id ?? "new"}`} name="totalVolume" defaultValue={book?.totalVolume ?? ""} maxLength={30}/></div>
      <div className="field span-2"><label htmlFor={`book-description-${book?.id ?? "new"}`}>설명</label><textarea className="textarea" id={`book-description-${book?.id ?? "new"}`} name="description" defaultValue={book?.description ?? ""} maxLength={5000}/></div>
      <div className="field"><label htmlFor={`book-cover-file-${book?.id ?? "new"}`}>표지 파일</label><input className="input file-input" id={`book-cover-file-${book?.id ?? "new"}`} type="file" name="coverFile" accept="image/jpeg,image/png,image/gif,image/webp"/><span className="muted small">최대 8MB. 새 파일을 선택하면 기존 표지가 교체됩니다.</span></div>
      </div>
      <div className="button-row book-form-actions">{saveAction ? <button className="button" type="submit" disabled={saving}>{saving ? "저장 중" : submitLabel}</button> : <SubmitButton pendingLabel="저장 중">{submitLabel}</SubmitButton>}</div>
    </form>
    {book && enrichAction && <form action={enrichAction} className="book-enrichment-form" title="빈 저자·설명과 각 권의 상품 링크를 알라딘에서 채웁니다.">
      <input type="hidden" name="bookId" value={book.id}/>
      {returnTo && <input type="hidden" name="returnTo" value={returnTo}/>}
      <SubmitButton pendingLabel="정보 검색 중" className="button button-outline" progress>저자/설명 알라딘에서 넣기</SubmitButton>
    </form>}
    {book && deleteAction && <form action={deleteAction} className="entity-delete-form" aria-label="책 삭제">
      <input type="hidden" name="bookId" value={book.id}/>
      {returnTo && <input type="hidden" name="returnTo" value={returnTo}/>}
      <ConfirmSubmitButton message="책과 모든 권, 연결된 재고를 삭제합니까?">책 삭제</ConfirmSubmitButton>
    </form>}
    </div>
  );
}
