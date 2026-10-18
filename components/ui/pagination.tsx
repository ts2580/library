import Link from "next/link";
import { pageNumbers } from "@/lib/pagination";

type Props = {
  page: number; totalPages: number; label: string; className?: string; disabled?: boolean;
} & ({ href: (page: number) => string; onPageChange?: never } | { href?: never; onPageChange: (page: number) => void });

export function Pagination({ page, totalPages, label, className = "", disabled = false, href, onPageChange }: Props) {
  const last = Math.max(1, totalPages);
  function control(target: number, text: string, ariaLabel: string) {
    const current = target === page;
    const unavailable = disabled || target < 1 || target > last;
    const props = { className: `page-link${current ? " page-link-current" : ""}`, "aria-label": ariaLabel,
      "aria-current": current ? "page" as const : undefined };
    return href && !unavailable
      ? <Link key={text} {...props} href={href(target)}>{text}</Link>
      : <button key={text} type="button" {...props} disabled={unavailable || current} onClick={onPageChange ? () => onPageChange(target) : undefined}>{text}</button>;
  }
  return <nav className={`pagination ${className}`} aria-label={label}>
    {control(page - 1, "이전", "이전 페이지")}
    {pageNumbers(page, last).map(number => control(number, String(number), `${number}페이지`))}
    {control(page + 1, "다음", "다음 페이지")}
  </nav>;
}
