import "server-only";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { withRequestGate } from "@/features/aladin/request-gate";

export class AladinRateLimitError extends AppError {
  constructor(message = "알라딘 요청 제한(429)으로 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.") {
    super(message, "ALADIN_RATE_LIMIT", 429);
    this.name = "AladinRateLimitError";
  }
}

export function aladinPageUrl(raw: string): URL {
  const url = new URL(raw, "https://www.aladin.co.kr");
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !["aladin.co.kr", "www.aladin.co.kr"].includes(url.hostname)
    || url.username || url.password || (url.port && url.port !== "443") || url.pathname.toLowerCase().startsWith("/ttb/")) {
    throw new AppError("허용되지 않은 알라딘 페이지 주소입니다.", "ALADIN_INVALID_URL");
  }
  url.hash = "";
  return url;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const maxBytes = 4 * 1024 * 1024;

export async function aladinHtml(rawUrl: string): Promise<string> {
  const url = aladinPageUrl(rawUrl);
  let backoff = env.ALADIN_INITIAL_BACKOFF_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      return await withRequestGate(path.join(env.dataDir, "aladin-requests.sqlite"), env.ALADIN_PAGE_INTERVAL_MS, async cooldown => {
        const response = await fetch(url, {
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { "user-agent": "Bookshelf/4.0", accept: "text/html,application/xhtml+xml" }
        });
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const ms = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : backoff;
          await cooldown(Number.isFinite(ms) ? Math.max(backoff, ms) : backoff);
          await response.body?.cancel();
          throw new AladinRateLimitError();
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new AppError(`알라딘 응답 오류(HTTP ${response.status})로 조회하지 못했습니다.`, "ALADIN_HTTP_ERROR", response.status >= 500 ? 503 : 502);
        }
        const type = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!/text\/html|application\/xhtml\+xml/.test(type)) {
          await response.body?.cancel();
          throw new AppError("알라딘이 정상 HTML 페이지를 반환하지 않았습니다.", "ALADIN_FORMAT_CHANGED", 502);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new AppError("알라딘 응답이 비어 있습니다.", "ALADIN_FORMAT_CHANGED", 502);
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) throw new AppError("알라딘 응답 크기 제한을 초과했습니다.", "ALADIN_FORMAT_CHANGED", 502);
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        return Buffer.concat(chunks).toString("utf8");
      });
    } catch (error) {
      if (error instanceof Error && error.message === "ALADIN_COOLDOWN") throw new AladinRateLimitError();
      const retryable = error instanceof AladinRateLimitError || error instanceof TypeError
        || error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        || error instanceof AppError && error.code === "ALADIN_HTTP_ERROR" && error.status === 503;
      if (!retryable || attempt >= env.ALADIN_MAX_ATTEMPTS) throw error;
      await sleep(backoff);
      backoff = Math.min(env.ALADIN_MAX_BACKOFF_MS, backoff * 2);
    }
  }
}
