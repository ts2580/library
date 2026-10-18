"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

function isBackdrop(event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

export function useDialogBackdropDismiss() {
  const pressedBackdrop = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) { pressedBackdrop.current = isBackdrop(event); },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismiss = pressedBackdrop.current && isBackdrop(event);
      pressedBackdrop.current = false;
      if (dismiss) event.currentTarget.close();
    }
  };
}
