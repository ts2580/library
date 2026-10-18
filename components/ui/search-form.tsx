"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProgressIndicator } from "@/components/ui/top-progress";

export function SearchForm({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form action={action} method="get" className={className} aria-busy={pending} onKeyDown={(event) => {
    if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
  }} onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string") query.append(key, value);
    startTransition(() => router.push(`${action}?${query}`, { scroll: false }));
  }}>
    <fieldset className="search-fields" disabled={pending}>{children}</fieldset>
    {pending && <ProgressIndicator/>}
  </form>;
}
