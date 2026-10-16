import "server-only";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const API_BASE = "https://www.aladin.co.kr/ttb/api/";
let requestTail = Promise.resolve();
let lastRequestAt = 0;

export class AladinRateLimitError extends Error {
  constructor(message = "알라딘 API 호출 제한이 계속되었습니다.") {
    super(message);
    this.name = "AladinRateLimitError";
  }
}

export function isAladinConfigured(): boolean {
  return env.ALADIN_TTB_KEY.trim().length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveRequestSlot(): Promise<void> {
  const previous = requestTail;
  let release!: () => void;
  requestTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const wait = Math.max(0, lastRequestAt + env.ALADIN_MIN_REQUEST_INTERVAL_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  release();
}

function buildUrl(endpoint: string, params: Record<string, string | number | boolean | null | undefined>): URL {
  const url = new URL(endpoint, API_BASE);
  url.searchParams.set("ttbkey", env.ALADIN_TTB_KEY);
  url.searchParams.set("output", "JS");
  url.searchParams.set("Version", "20131101");
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== false) url.searchParams.set(key, String(value === true ? 1 : value));
  }
  return url;
}


function normalizedAladinPage(rawUrl: string): URL {
  const url = new URL(rawUrl, "https://www.aladin.co.kr");
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || !["aladin.co.kr", "www.aladin.co.kr"].includes(host)) {
    throw new Error("허용되지 않은 알라딘 페이지 주소입니다.");
  }
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("허용되지 않은 알라딘 페이지 주소입니다.");
  }
  return url;
}

export async function aladinHtml(rawUrl: string): Promise<string> {
  const url = normalizedAladinPage(rawUrl);
  let backoff = env.ALADIN_INITIAL_BACKOFF_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= env.ALADIN_MAX_ATTEMPTS; attempt += 1) {
    await reserveRequestSlot();
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "user-agent": "Bookshelf/3.0",
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
        }
      });
      if (response.status === 429) {
        lastError = new AladinRateLimitError();
        if (attempt < env.ALADIN_MAX_ATTEMPTS) {
          await sleep(backoff);
          backoff = Math.min(env.ALADIN_MAX_BACKOFF_MS, backoff * 2);
          continue;
        }
        throw lastError;
      }
      if (!response.ok) throw new Error(`Aladin page HTTP ${response.status}`);
      const type = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (type && !type.includes("text/html") && !type.includes("application/xhtml+xml")) {
        throw new Error("알라딘 지점 페이지가 HTML이 아닙니다.");
      }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(length) && length > 4 * 1024 * 1024) throw new Error("알라딘 지점 페이지가 너무 큽니다.");
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 4 * 1024 * 1024) throw new Error("알라딘 지점 페이지가 너무 큽니다.");
      return text;
    } catch (error) {
      lastError = error;
      if (error instanceof AladinRateLimitError) throw error;
      if (attempt < env.ALADIN_MAX_ATTEMPTS) {
        await sleep(backoff);
        backoff = Math.min(env.ALADIN_MAX_BACKOFF_MS, backoff * 2);
        continue;
      }
    }
  }
  logger.warn("Aladin branch page request failed", {
    host: url.hostname,
    error: lastError instanceof Error ? lastError.message : String(lastError)
  });
  throw lastError instanceof Error ? lastError : new Error("알라딘 지점 페이지 요청에 실패했습니다.");
}

export async function aladinJson(endpoint: string, params: Record<string, string | number | boolean | null | undefined>): Promise<unknown> {
  if (!isAladinConfigured()) throw new Error("ALADIN_TTB_KEY가 설정되어 있지 않습니다.");
  const url = buildUrl(endpoint, params);
  let backoff = env.ALADIN_INITIAL_BACKOFF_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= env.ALADIN_MAX_ATTEMPTS; attempt += 1) {
    await reserveRequestSlot();
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: { "user-agent": "Bookshelf/3.0" }
      });
      if (response.status === 429) {
        lastError = new AladinRateLimitError();
        if (attempt < env.ALADIN_MAX_ATTEMPTS) {
          await sleep(backoff);
          backoff = Math.min(env.ALADIN_MAX_BACKOFF_MS, backoff * 2);
          continue;
        }
        throw lastError;
      }
      if (!response.ok) throw new Error(`Aladin HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (payload && typeof payload === "object" && "errorCode" in payload && Number(payload.errorCode) !== 0) {
        throw new AppError("알라딘 API가 요청을 거절했습니다. 연동 설정을 확인해 주세요.", "ALADIN_REJECTED", 502);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error instanceof AladinRateLimitError || error instanceof AppError) throw error;
      if (attempt < env.ALADIN_MAX_ATTEMPTS) {
        await sleep(backoff);
        backoff = Math.min(env.ALADIN_MAX_BACKOFF_MS, backoff * 2);
        continue;
      }
    }
  }

  logger.warn("Aladin request failed", { endpoint, error: lastError instanceof Error ? lastError.message : String(lastError) });
  throw lastError instanceof Error ? lastError : new Error("알라딘 API 요청에 실패했습니다.");
}
