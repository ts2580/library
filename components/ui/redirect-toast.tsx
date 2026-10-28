"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { showToast } from "@/components/ui/toast";

export function RedirectToast({ message }: { message: string }) {
  const params = useSearchParams();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("message") !== message) return;
    showToast(message);
    // Consume only the notification, preserving filters, return context and scroll.
    url.searchParams.delete("message");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [message, params]);
  return null;
}
