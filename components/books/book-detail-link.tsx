"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { bookDetailHref } from "@/features/books/navigation";

export function BookDetailLink({ bookId, className, children, returnQuery }: {
  bookId: number; className?: string; children: ReactNode; returnQuery?: Record<string, string>;
}) {
  const pathname = usePathname();
  const query = useSearchParams();
  const listQuery = new URLSearchParams(query.toString());
  for (const [key, value] of Object.entries(returnQuery ?? {})) listQuery.set(key, value);
  const returnTo = pathname.startsWith("/books/") ? query.get("returnTo") : `${pathname}${listQuery.size ? `?${listQuery}` : ""}`;
  return <Link href={bookDetailHref(bookId, returnTo)} className={className}>{children}</Link>;
}
