"use client";

import { useEffect, useId, useRef } from "react";
import { CategorySelect } from "@/components/books/category-select";
import { useDialogBackdropDismiss } from "@/components/ui/use-dialog-backdrop-dismiss";

/** Render inside the registration form so its category is included on confirmation. */
export function NewBookCategoryDialog({ open, onClose, categories, count, saving, error }: {
  open: boolean; onClose: () => void; categories: string[]; count: number; saving: boolean; error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const id = useId();
  const backdropDismiss = useDialogBackdropDismiss();
  useEffect(() => {
    if (!open || !dialog.current) return;
    dialog.current.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  return <dialog ref={dialog} className="new-book-category-dialog" aria-labelledby={`${id}-title`} onClose={onClose}
    onCancel={event => { if (saving) event.preventDefault(); }} {...(saving ? {} : backdropDismiss)}
    onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !saving) {
        event.preventDefault();
        event.currentTarget.closest("form")?.requestSubmit(confirm.current);
      }
    }}>
    <div className="new-book-category-dialog-header"><h2 id={`${id}-title`}>새 책 카테고리</h2>
      <button type="button" className="button button-outline button-small" disabled={saving} aria-label="카테고리 선택 닫기" onClick={() => dialog.current?.close()}>닫기</button>
    </div>
    <div className="new-book-category-dialog-body stack-md">
      <p className="muted small">새 책에 사용할 카테고리를 선택해 주세요.</p>
      <fieldset className="category-fieldset" disabled={!open || saving}><CategorySelect id={`${id}-category`} categories={categories} required/></fieldset>
      {open && error && <p className="flash flash-error" role="alert">{error}</p>}
      <div className="button-row new-book-category-actions">
        <button type="button" className="button button-outline" disabled={saving} onClick={() => dialog.current?.close()}>취소</button>
        <button ref={confirm} type="submit" className="button" disabled={!open || saving || !count}>{saving ? "등록 중" : `${count}권 추가`}</button>
      </div>
    </div>
  </dialog>;
}
