"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

export function SearchForm({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form action={action} method="get" className={className} aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string") query.append(key, value);
    startTransition(() => router.push(`${action}?${query}`));
  }}>
    <fieldset className="search-fields" disabled={pending}>{children}</fieldset>
    {pending && <Spinner/>}
  </form>;
}
