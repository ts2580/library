export interface ClientErrorDetails {
  code: string;
  message: string;
  status?: number;
  source: string;
  eventId?: string;
  occurredAt: string;
}

const listeners = new Set<() => void>();
const dismissed = new Map<string, string>();
const acknowledgedEvents = new Set<string>();
const ACKNOWLEDGED_EVENTS_KEY = "bookshelf.acknowledged-errors.v1";
const MAX_ACKNOWLEDGED_EVENTS = 100;
let acknowledgedEventsLoaded = false;
let pending: ClientErrorDetails[] = [];
const signature = (error: Pick<ClientErrorDetails, "code" | "message">) => `${error.code}\n${error.message}`;
const notify = () => listeners.forEach(listener => listener());

function eventKey(error: Pick<ClientErrorDetails, "source" | "eventId">): string | null {
  return error.eventId ? JSON.stringify([error.source, error.eventId]) : null;
}

function loadAcknowledgedEvents(): void {
  if (acknowledgedEventsLoaded) return;
  acknowledgedEventsLoaded = true;
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(ACKNOWLEDGED_EVENTS_KEY) ?? "[]");
    if (Array.isArray(saved)) for (const key of saved.slice(-MAX_ACKNOWLEDGED_EVENTS)) {
      if (typeof key === "string") acknowledgedEvents.add(key);
    }
  } catch { /* In-memory acknowledgement still works when storage is unavailable. */ }
}

export const subscribeErrors = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const currentError = () => pending[0] ?? null;
export const serverErrorSnapshot = () => null;

export function reportClientError(input: Omit<ClientErrorDetails, "occurredAt">): void {
  if (typeof window === "undefined") return;
  const error = { ...input, code: /^[A-Z][A-Z0-9_]{1,79}$/.test(input.code) ? input.code : "REQUEST_FAILED", occurredAt: new Date().toISOString() };
  const key = eventKey(error);
  if (key) {
    loadAcknowledgedEvents();
    if (acknowledgedEvents.has(key)) return;
  } else if (dismissed.get(error.source) === signature(error)) return;
  if (pending.some(item => key ? eventKey(item) === key : !item.eventId && item.source === error.source && signature(item) === signature(error))) return;
  pending = [...pending, error].slice(0, 5);
  notify();
}

export function dismissClientError(error: ClientErrorDetails): void {
  if (pending[0] !== error) return;
  const key = eventKey(error);
  if (key) {
    acknowledgedEvents.add(key);
    if (acknowledgedEvents.size > MAX_ACKNOWLEDGED_EVENTS) acknowledgedEvents.delete(acknowledgedEvents.values().next().value!);
    try { window.sessionStorage.setItem(ACKNOWLEDGED_EVENTS_KEY, JSON.stringify([...acknowledgedEvents])); }
    catch { /* Keep the acknowledgement in memory. */ }
  } else {
    dismissed.set(error.source, signature(error));
    if (dismissed.size > 100) dismissed.delete(dismissed.keys().next().value!);
  }
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
