import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, errorParams } from "@/lib/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { jsonError } from "@/lib/http";
import { apiFetch } from "@/lib/api-fetch";
import { clearReportedError, currentError, dismissClientError, reportClientError, sanitizedErrorDetails } from "@/lib/client-errors";

beforeEach(() => { vi.stubGlobal("window", {}); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => {
  while (currentError()) clearReportedError(currentError()!.source);
  for (const source of ["poll", "GET /api/test", "POST /api/test"]) clearReportedError(source);
  vi.unstubAllGlobals();
});

describe("structured error responses", () => {
  it("preserves an application code and HTTP status", async () => {
    const response = jsonError(new AppError("작업이 이미 실행 중입니다.", "JOB_ACTIVE", 409));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: "JOB_ACTIVE", message: "작업이 이미 실행 중입니다." });
  });
  it("classifies validation failures and hides unexpected internal details", async () => {
    const parsed = z.string().min(3).safeParse("");
    expect(await jsonError(parsed.error).json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await jsonError(new Error("secret database path"), "처리 실패").json()).toEqual({ success: false, code: "INTERNAL_ERROR", message: "처리 실패" });
    expect(new URLSearchParams(errorParams(new AppError("금지", "FORBIDDEN", 403))).get("errorCode")).toBe("FORBIDDEN");
  });
});

describe("client error reporting", () => {
  it("keeps the response readable and exposes its server error code", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ code: "JOB_ACTIVE", message: "이미 실행 중" }, { status: 409 }));
    const response = await apiFetch("/api/test", { method: "POST" });
    expect(await response.json()).toEqual({ code: "JOB_ACTIVE", message: "이미 실행 중" });
    expect(currentError()).toMatchObject({ code: "JOB_ACTIVE", status: 409, source: "POST /api/test" });
  });
  it("does not reopen a dismissed polling error until recovery", () => {
    const input = { code: "HTTP_503", message: "잠시 후 재시도", source: "poll" };
    reportClientError(input); const first = currentError()!;
    reportClientError(input); dismissClientError(first);
    expect(currentError()).toBeNull();
    reportClientError(input); expect(currentError()).toBeNull();
    clearReportedError("poll"); reportClientError(input);
    expect(currentError()).toMatchObject(input);
  });
  it("clears a recovered request and reports network failures but ignores cancellation", async () => {
    reportClientError({ code: "CLIENT_TIMEOUT", message: "지연", source: "GET /api/test" });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true }));
    await apiFetch("/api/test"); expect(currentError()).toBeNull();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(apiFetch("/api/test")).rejects.toThrow();
    expect(currentError()?.code).toBe("NETWORK_ERROR");
    clearReportedError("GET /api/test");
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(apiFetch("/api/test", { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(currentError()).toBeNull();
  });
  it("removes authorization values and URL credentials from copied details", () => {
    const text = sanitizedErrorDetails({ code: "HTTP_500", message: "Bearer super-secret https://user:pass@example.com/path?token=private", source: "poll", occurredAt: "fixture" });
    expect(text).not.toContain("super-secret"); expect(text).not.toContain("user:pass"); expect(text).not.toContain("private");
  });
});
