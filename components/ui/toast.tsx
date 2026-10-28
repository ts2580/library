"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Toast = { id: number; message: string };
const empty: Toast[] = [];
let toasts = empty;
let sequence = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => toasts;
const serverSnapshot = () => empty;
const notify = () => listeners.forEach(listener => listener());

export function showToast(message: string) {
  if (!message.trim()) return;
  toasts = [...toasts.filter(toast => toast.message !== message), { id: ++sequence, message }].slice(-3);
  notify();
}

function dismiss(id: number) {
  toasts = toasts.filter(toast => toast.id !== id);
  notify();
}

function ToastItem({ toast }: { toast: Toast }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = setTimeout(() => dismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, hovered, focused]);
  return <div className="toast flash-success" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <p className="toast-message" role="status" aria-live="polite" aria-atomic="true">{toast.message}</p>
    <button type="button" className="toast-close" aria-label="알림 닫기" onClick={() => dismiss(toast.id)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>
  </div>;
}

export function ToastHost() {
  const items = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // Keep notifications visible above native dialogs without moving focus.
    if (items.length) {
      if (element.matches(":popover-open")) element.hidePopover();
      element.showPopover();
    } else if (element.matches(":popover-open")) element.hidePopover();
  }, [items]);
  return <div ref={host} className="toast-host" popover="manual" aria-label="작업 알림">
    {items.map(toast => <ToastItem key={toast.id} toast={toast}/>)}
  </div>;
}
