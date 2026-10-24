import { clearReportedError, reportClientError } from "@/lib/client-errors";

/** Preserve Response semantics for upload/retry callers while reporting structured API failures. */
export async function apiFetch(url: string, init?: RequestInit, options: { reportError?: boolean; silentStatuses?: number[]; reportNetworkErrors?: boolean; deduplicate?: boolean } = {}): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const source = `${method} ${url.split("?")[0]}`;
  if (method !== "GET" && !options.deduplicate) clearReportedError(source);
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) {
    init?.signal?.throwIfAborted();
    if (options.reportError !== false && options.reportNetworkErrors !== false && !init?.signal?.aborted && !(error instanceof Error && error.name === "AbortError")) {
      reportClientError({ code: "NETWORK_ERROR", message: "서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.", source });
    }
    throw error;
  }
  if (response.ok) clearReportedError(source);
  else if (options.reportError !== false && !options.silentStatuses?.includes(response.status)) {
    const body = await response.clone().json().catch(() => null) as { code?: unknown; message?: unknown } | null;
    if (!init?.signal?.aborted) reportClientError({
      code: typeof body?.code === "string" ? body.code : `HTTP_${response.status}`,
      message: typeof body?.message === "string" ? body.message : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      status: response.status, source
    });
  }
  return response;
}
