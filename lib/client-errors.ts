export interface ClientErrorDetails {
  code: string;
  message: string;
  status?: number;
  source: string;
  occurredAt: string;
}

const listeners = new Set<() => void>();
const dismissed = new Map<string, string>();
let pending: ClientErrorDetails[] = [];
const signature = (error: Pick<ClientErrorDetails, "code" | "message">) => `${error.code}\n${error.message}`;
const notify = () => listeners.forEach(listener => listener());

export const subscribeErrors = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const currentError = () => pending[0] ?? null;
export const serverErrorSnapshot = () => null;

export function reportClientError(input: Omit<ClientErrorDetails, "occurredAt">): void {
  if (typeof window === "undefined") return;
  const error = { ...input, code: /^[A-Z][A-Z0-9_]{1,79}$/.test(input.code) ? input.code : "REQUEST_FAILED", occurredAt: new Date().toISOString() };
  if (dismissed.get(error.source) === signature(error)) return;
  if (pending.some(item => item.source === error.source && signature(item) === signature(error))) return;
  pending = [...pending, error].slice(0, 5);
  notify();
}

export function dismissClientError(error: ClientErrorDetails): void {
  if (pending[0] !== error) return;
  dismissed.set(error.source, signature(error));
  if (dismissed.size > 100) dismissed.delete(dismissed.keys().next().value!);
  pending = pending.slice(1);
  notify();
}

export function clearReportedError(source: string): void {
  dismissed.delete(source);
  const remaining = pending.filter(error => error.source !== source);
  if (remaining.length !== pending.length) { pending = remaining; notify(); }
}

export function sanitizedErrorDetails(error: ClientErrorDetails): string {
  return JSON.stringify(error, null, 2)
    .replace(/\b(Bearer|Basic)\s+[^\s"\\]+/gi, "$1 [비밀값 제거]")
    .replace(/((?:access_token|refresh_token|token|password|secret|authorization)\s*[:=]\s*)[^\s,"\\]+/gi, "$1[비밀값 제거]")
    .replace(/https?:\/\/[^\s<>"\\]+/gi, raw => {
      try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
      catch { return "[URL 제거]"; }
    });
}
