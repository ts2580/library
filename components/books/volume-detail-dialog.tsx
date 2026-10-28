"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDialogBackdropDismiss } from "@/components/ui/use-dialog-backdrop-dismiss";

export function VolumeDetailDialog({ title, children, triggerLabel = "상세정보", className = "" }: { title: string; children: ReactNode; triggerLabel?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
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
    <button type="button" className="button button-outline button-small" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>{triggerLabel}</button>
    <dialog ref={dialog} id={id} className={`volume-detail-dialog ${className}`} aria-labelledby={titleId} onClose={() => setOpen(false)} {...backdropDismiss}>
      <div className="volume-detail-dialog-header"><div><p className="eyebrow">{triggerLabel}</p><h2 id={titleId}>{title}</h2></div>
        <button type="button" className="button button-outline button-small" aria-label={`${triggerLabel} 닫기`} onClick={() => dialog.current?.close()}>닫기</button>
      </div>
      {open && <div className="volume-detail-dialog-body stack-md">{children}</div>}
    </dialog>
  </>;
}
