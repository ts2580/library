const ORIGIN = "https://bookshelf.invalid";
const listPath = /^\/(?:books|products|dashboard|inventory(?:\/logs|\/branches\/[^/]+)?|aladin\/(?:search|used))$/;

export function bookReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || !value.startsWith("/") || value.startsWith("//") || /[\u0000-\u001f\u007f]/.test(value)) return "/books";
  try {
    const url = new URL(value, ORIGIN);
    if (url.origin !== ORIGIN || !listPath.test(url.pathname)) return "/books";
    for (const key of ["message", "error", "errorCode", "returnTo"]) url.searchParams.delete(key);
    return `${url.pathname}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
  } catch { return "/books"; }
}

export function bookDetailHref(bookId: number, returnTo?: unknown, feedback?: string | Record<string, string>): string {
  const query = new URLSearchParams(feedback);
  query.delete("returnTo");
  const origin = bookReturnTo(returnTo);
  if (origin !== "/books") query.set("returnTo", origin);
  return `/books/${bookId}${query.size ? `?${query}` : ""}`;
}

export function bookDeletedHref(returnTo: unknown): string {
  const url = new URL(bookReturnTo(returnTo), ORIGIN);
  url.searchParams.set("message", "책을 삭제했습니다.");
  return `${url.pathname}?${url.searchParams}`;
}
