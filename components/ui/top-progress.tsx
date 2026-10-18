"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLinkStatus } from "next/link";

const requests = new Set<symbol>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => requests.size;
const serverSnapshot = () => 0;
const notify = () => listeners.forEach(listener => listener());

// Each mounted request owns its token, so completion or cancellation cannot hide another request.
export function useTopProgress(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const token = Symbol();
    requests.add(token); notify();
    return () => { requests.delete(token); notify(); };
  }, [active]);
}

export function TopProgressBar() {
  const active = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    // A manual popover stays above native dialogs without taking focus or blocking clicks.
    if (active) {
      if (element.matches(":popover-open")) element.hidePopover();
      element.showPopover();
    }
    else if (element.matches(":popover-open")) element.hidePopover();
  }, [active]);
  return <div ref={bar} id="top-progress-bar" popover="manual" role="progressbar" aria-label="작업 진행 중"/>;
}

export function ProgressIndicator({ label = "검색 중" }: { label?: string }) {
  useTopProgress(true);
  return <span className="loading-status" role="status">{label}</span>;
}

export function LinkProgress() {
  const { pending } = useLinkStatus();
  useTopProgress(pending);
  return null;
}
