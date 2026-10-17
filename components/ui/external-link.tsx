import type { ReactNode } from "react";
import { normalizeHttpUrl } from "@/lib/urls";

export function ExternalLink({
  href,
  className,
  children
}: {
  href: string | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const safeHref = normalizeHttpUrl(href);
  if (!safeHref) return null;
  return <a className={className} href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a>;
}
