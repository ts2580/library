"use client";

import { useEffect, useRef } from "react";

export function CoverPreview() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
    let active: HTMLImageElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let press: { id: number; x: number; y: number } | null = null;
    let longPressVisible = false;
    let suppressClick: { image: HTMLImageElement; until: number } | null = null;
    const coverAt = (target: EventTarget | null) => target instanceof HTMLImageElement && target.hasAttribute("data-cover-preview") ? target : null;

    function hide() {
      clearTimeout(timer);
      active = null; press = null; longPressVisible = false;
      if (element!.matches(":popover-open")) element!.hidePopover();
      element!.replaceChildren();
    }

    function show(source: HTMLImageElement, longPress = false) {
      if (!source.isConnected || (source.complete && !source.naturalWidth)) { hide(); return; }
      active = source;
      const image = new Image();
      image.alt = source.alt;
      image.referrerPolicy = "no-referrer";
      image.onload = () => {
        if (active !== source || !source.isConnected || element!.firstChild !== image) return;
        const scale = Math.min(1, (window.innerWidth - 36) / image.naturalWidth, (window.innerHeight - 36) / image.naturalHeight);
        image.width = Math.max(1, Math.round(image.naturalWidth * scale));
        image.height = Math.max(1, Math.round(image.naturalHeight * scale));
        longPressVisible = longPress;
        element!.showPopover();
      };
      image.onerror = () => { if (element!.firstChild === image) hide(); };
      element!.replaceChildren(image);
      image.src = source.currentSrc || source.src;
    }

    function over(event: PointerEvent) {
      const source = coverAt(event.target);
      if (event.pointerType === "mouse" && canHover.matches && source) show(source);
    }
    function out(event: PointerEvent) {
      if (event.pointerType === "mouse" && coverAt(event.target) === active) hide();
    }
    function down(event: PointerEvent) {
      hide();
      const source = coverAt(event.target);
      if (!source || event.pointerType === "mouse" || !event.isPrimary) return;
      active = source;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      // Match the Java UI: hold for 450ms, cancel when movement exceeds 12px.
      timer = setTimeout(() => { if (active === source) show(source, true); }, 450);
    }
    function move(event: PointerEvent) {
      if (!press || event.pointerId !== press.id) return;
      if (Math.abs(event.clientX - press.x) > 12 || Math.abs(event.clientY - press.y) > 12) hide();
    }
    function up(event: PointerEvent) {
      if (!press || event.pointerId !== press.id) return;
      if (longPressVisible && active) suppressClick = { image: active, until: performance.now() + 500 };
      hide();
    }
    function click(event: MouseEvent) {
      if (suppressClick && performance.now() < suppressClick.until && coverAt(event.target) === suppressClick.image) {
        event.preventDefault(); event.stopPropagation(); suppressClick = null;
      }
    }
    function preventNative(event: Event) { if (coverAt(event.target)) event.preventDefault(); }
    function key(event: KeyboardEvent) { if (event.key === "Escape") hide(); }
    function visibility() { if (document.hidden) hide(); }

    // Delegation also covers images added by search, pagination and dialogs.
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", hide);
    document.addEventListener("click", click, true);
    document.addEventListener("contextmenu", preventNative);
    document.addEventListener("dragstart", preventNative);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    const observer = new MutationObserver(records => {
      if (active && (!active.isConnected || records.some(record => record.type === "attributes" && record.target === active))) hide();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    return () => {
      observer.disconnect();
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", hide);
      document.removeEventListener("click", click, true);
      document.removeEventListener("contextmenu", preventNative);
      document.removeEventListener("dragstart", preventNative);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  return <div ref={host} className="cover-preview" popover="manual" aria-hidden="true"/>;
}
