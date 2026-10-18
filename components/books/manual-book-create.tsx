"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AladinSelection } from "@/components/books/aladin-selection";
import type { BookOption } from "@/components/books/existing-book-select";
import { useDialogBackdropDismiss } from "@/components/ui/use-dialog-backdrop-dismiss";

export function ManualBookCreate({ categories, options }: { categories: string[]; options: BookOption[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const titleId = useId();
  const backdropDismiss = useDialogBackdropDismiss();

  useEffect(() => {
    if (!open || !dialog.current) return;
    dialog.current.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  return <>
    <button className="button button-secondary button-small manual-book-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={() => setOpen(true)}>책 직접 추가</button>
    <dialog ref={dialog} id={dialogId} className="manual-book-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)} {...backdropDismiss}>
      <div className="manual-book-dialog-header"><h2 id={titleId}>책 직접 추가</h2><button className="button button-outline button-small" type="button" aria-label="책 직접 추가 닫기" onClick={() => dialog.current?.close()}>닫기</button></div>
      {open && <div className="manual-book-dialog-body"><AladinSelection manual categories={categories} query="" initial={null} initialOptions={options} selectedBookId={null}/></div>}
    </dialog>
  </>;
}
