import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSearchPreview } from "@/features/aladin/search-client";

const result = { items: [], totalResults: 0, page: 1, pageSize: 20 };
const params = new URLSearchParams({ query: "전희 서바이벌 사가", page: "1" });
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Aladin preview GET recovery", () => {
  it("retries a dropped connection once and returns the recovered preview", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(Response.json(result));
    const assertion = expect(fetchSearchPreview(params, new AbortController().signal)).resolves.toEqual(result);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
  });

  it.each([502, 503, 504])("recovers from an HTML proxy error with HTTP %s", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad Gateway</html>", { status })).mockResolvedValueOnce(Response.json(result));
    const assertion = expect(fetchSearchPreview(params, new AbortController().signal)).resolves.toEqual(result);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("limits retries and explains a continuing connection failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const assertion = expect(fetchSearchPreview(params, new AbortController().signal)).rejects.toThrow("알라딘 검색 서버에 연결하지 못했습니다");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 429])("preserves the server error without retrying HTTP %s", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ message: "요청을 확인해 주세요." }, { status }));
    await expect(fetchSearchPreview(params, new AbortController().signal)).rejects.toThrow("요청을 확인해 주세요.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("explains a persistent HTML gateway error without exposing JSON parser details", async () => {
    fetchMock.mockImplementation(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
    const assertion = expect(fetchSearchPreview(params, new AbortController().signal)).rejects.toThrow("알라딘 검색 응답을 확인하지 못했습니다 (HTTP 502)");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels a retry when the modal closes or the query changes", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const controller = new AbortController();
    const operation = fetchSearchPreview(params, controller.signal);
    const assertion = expect(operation).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await assertion;
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
