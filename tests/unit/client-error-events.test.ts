import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let values: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("acknowledged job errors", () => {
  const input = { code: "STOCK_REFRESH_FAILED", message: "재고 조회 실패", source: "stock-worker", eventId: "run-one" };
  it("keeps an acknowledged job dismissed after reporter cleanup, a clean page and a document reload", async () => {
    let errors = await import("@/lib/client-errors");
    errors.reportClientError(input);
    errors.dismissClientError(errors.currentError()!);
    errors.clearReportedError(input.source);
    errors.reportClientError(input);
    expect(errors.currentError()).toBeNull();
    vi.resetModules();
    errors = await import("@/lib/client-errors");
    errors.reportClientError(input);
    expect(errors.currentError()).toBeNull();
    expect([...values.values()].join("")).not.toContain(input.message);
  });
  it("shows a different run even when its message and code are unchanged", async () => {
    const errors = await import("@/lib/client-errors");
    errors.reportClientError(input);
    errors.dismissClientError(errors.currentError()!);
    errors.reportClientError({ ...input, eventId: "run-two" });
    expect(errors.currentError()).toMatchObject({ eventId: "run-two", message: input.message });
  });
  it("deduplicates a run across changing messages but keeps distinct queued runs", async () => {
    const errors = await import("@/lib/client-errors");
    errors.reportClientError(input);
    errors.reportClientError({ ...input, message: "더 자세한 실패 이유" });
    errors.reportClientError({ ...input, eventId: "run-two" });
    errors.dismissClientError(errors.currentError()!);
    expect(errors.currentError()?.eventId).toBe("run-two");
    errors.dismissClientError(errors.currentError()!);
    expect(errors.currentError()).toBeNull();
  });
  it("continues reporting and acknowledging in memory when browser storage is blocked", async () => {
    Object.defineProperty(window, "sessionStorage", { get: () => { throw new Error("storage blocked"); } });
    const errors = await import("@/lib/client-errors");
    expect(() => errors.reportClientError(input)).not.toThrow();
    expect(() => errors.dismissClientError(errors.currentError()!)).not.toThrow();
    errors.clearReportedError(input.source);
    errors.reportClientError(input);
    expect(errors.currentError()).toBeNull();
    errors.reportClientError({ ...input, eventId: "run-two" });
    expect(errors.currentError()?.eventId).toBe("run-two");
  });
});
