import { apiFetch } from "@/lib/api-fetch";
import { abortable } from "@/lib/abortable";
import type { AladinSearchResult } from "@/features/aladin/types";

const CONNECTION_ERROR = "알라딘 검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const TEMPORARY_STATUSES = new Set([502, 503, 504]);

export async function fetchSearchPreview(params: URLSearchParams, signal: AbortSignal): Promise<AladinSearchResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await abortable(new Promise<void>((resolve) => setTimeout(resolve, 500)), signal);
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await apiFetch(`/api/aladin/search?${params}`, { cache: "no-store", signal }, {
        silentStatuses: attempt === 0 ? [...TEMPORARY_STATUSES] : [], reportNetworkErrors: attempt > 0
      });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TypeError && attempt === 0) continue;
      throw new Error(CONNECTION_ERROR);
    }
    if (TEMPORARY_STATUSES.has(response.status) && attempt === 0) {
      await response.body?.cancel();
      continue;
    }
    const fallback = `알라딘 검색 응답을 확인하지 못했습니다${response.ok ? "" : ` (HTTP ${response.status})`}. 잠시 후 다시 시도해 주세요.`;
    let body;
    try { body = await response.json(); }
    catch { signal.throwIfAborted(); throw new Error(fallback); }
    if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : fallback);
    return body as AladinSearchResult;
  }
  throw new Error(CONNECTION_ERROR);
}
