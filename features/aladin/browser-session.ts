import "server-only";
import path from "node:path";
import { withRequestGate } from "@/features/aladin/request-gate";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { sqlite } from "@/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const loginUrl = "https://www.aladin.co.kr/login/wlogin.aspx";
const origin = new URL(loginUrl).origin;
const stockPaths = new Set(["/search/wsearchresult.aspx", "/shop/wproduct.aspx", "/shop/usedshop/wuseditemall.aspx"]);

type Connection = { sessionId: string | null; generation: string; ready: number };
export const stockBrowser = new AsyncLocalStorage<{ ownerId: number; generation: string }>();

export function canConnectBrowser(username: string) {
  return username === env.ALADIN_BROWSER_OWNER;
}

function connection(ownerId: number) {
  if (!env.ALADIN_BROWSER_OWNER) return;
  return sqlite.prepare(`SELECT c.session_id sessionId, c.generation, c.ready FROM aladin_browser_connection c
    JOIN member m ON m.id=c.owner_id WHERE c.owner_id=? AND m.username=?`).get(ownerId, env.ALADIN_BROWSER_OWNER) as Connection | undefined;
}

async function hasOpenWindow(current?: Connection) {
  if (!current?.ready || !current.sessionId) return false;
  try {
    const handles = await driver("GET", "/session/" + encodeURIComponent(current.sessionId) + "/window/handles");
    if (!Array.isArray(handles)) throw new AppError("브라우저 창 목록을 확인할 수 없습니다.", "ALADIN_BROWSER_ERROR", 502);
    return handles.length > 0;
  } catch (error) {
    if (error instanceof AppError && error.code === "ALADIN_BROWSER_CLOSED") return false;
    throw error;
  }
}

export async function getStockBrowserStatus(ownerId: number) {
  if (!connection(ownerId)?.ready) return "disconnected";
  try {
    const open = await withBrowserSlot(() => hasOpenWindow(connection(ownerId)));
    return open ? "connected" : "disconnected";
  } catch (error) {
    if (error instanceof AppError) return "unavailable";
    throw error;
  }
}

async function driver(method: string, endpoint: string, body?: object) {
  let response: Response;
  try {
    response = await fetch(new URL(endpoint, env.ALADIN_BROWSER_URL), {
      method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25_000),
      headers: { "content-type": "application/json; charset=utf-8" }, body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new AppError("서버의 알라딘 전용 브라우저에 연결할 수 없습니다.", "ALADIN_BROWSER_OFFLINE", 503);
  }
  const result = await response.json().catch(() => null);
  if (result?.value?.error === "invalid session id" || result?.value?.error === "no such window") {
    throw new AppError("알라딘 브라우저가 종료되었습니다. 프로필에서 전용 브라우저를 다시 연결해 주세요.", "ALADIN_BROWSER_CLOSED", 409);
  }
  if (!response.ok || !result || result.value?.error) {
    throw new AppError("알라딘 브라우저 요청에 실패했습니다. 서버의 연결 상태를 확인해 주세요.", "ALADIN_BROWSER_ERROR", 502);
  }
  return result.value;
}

async function closeSession(sessionId: string) {
  try { await driver("DELETE", "/session/" + encodeURIComponent(sessionId)); }
  catch (error) { if (!(error instanceof AppError && error.code === "ALADIN_BROWSER_CLOSED")) throw error; }
}

async function fitLoginWindow(endpoint: string) {
  try {
    const size = await driver("POST", endpoint + "/execute/sync", {
      script: "return { width: screen.availWidth, height: screen.availHeight }", args: []
    });
    if (size?.width > 0 && size?.height > 0) {
      await driver("POST", endpoint + "/window/rect", { x: 0, y: 0, width: size.width, height: size.height });
    }
  } catch (error) {
    logger.warn("Aladin browser window resize failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

// Web and worker share one configured browser. Hold its OS-backed slot across
// the complete operation, starting the WebDriver timeout only after admission.
function withBrowserSlot<T>(operation: () => Promise<T>) {
  return withRequestGate(path.join(env.dataDir, "aladin-browser.sqlite"), 0, operation, 1);
}

async function removeConnection(ownerId: number, current: Connection) {
  let id = current.sessionId;
  if (!id) {
    // A crash can also lose the response to POST /session. Recover the session
    // by the name sent when creating it on this dedicated Selenium Grid.
    const status = await driver("GET", "/status");
    if (!Array.isArray(status?.nodes)) throw new AppError("전용 브라우저의 세션 목록을 확인하지 못했습니다.");
    for (const node of status.nodes) {
      for (const slot of node.slots ?? []) {
        const name = slot.session?.capabilities?.["se:name"];
        if (name === `Bookshelf Aladin ${current.generation}` || name === "Bookshelf Aladin") id = slot.session.sessionId;
      }
    }
  }
  if (id) await closeSession(id);
  sqlite.prepare("DELETE FROM aladin_browser_connection WHERE owner_id=? AND generation=?").run(ownerId, current.generation);
}

export async function connectStockBrowser(ownerId: number, username: string) {
  if (!canConnectBrowser(username)) throw new AppError("이 계정에는 전용 브라우저가 설정되지 않았습니다.", "FORBIDDEN", 403);
  return withBrowserSlot(async () => {
    const previous = connection(ownerId);
    if (await hasOpenWindow(previous)) return;
    if (previous) await removeConnection(ownerId, previous);
    const generation = randomUUID();
    sqlite.prepare(`INSERT INTO aladin_browser_connection(owner_id,generation,created_at,ready)
      VALUES(?,?,unixepoch(),0)`).run(ownerId, generation);
    const created = await driver("POST", "/session", { capabilities: { alwaysMatch: { browserName: "firefox", "moz:firefoxOptions": {},
      "se:name": `Bookshelf Aladin ${generation}`, timeouts: { pageLoad: 15_000, script: 20_000 } } } });
    if (typeof created?.sessionId !== "string" || !created.sessionId) throw new AppError("브라우저를 열지 못했습니다.");
    const sessionId: string = created.sessionId;
    try {
      if (!sqlite.prepare("UPDATE aladin_browser_connection SET session_id=? WHERE owner_id=? AND generation=?")
        .run(sessionId, ownerId, generation).changes) throw new AppError("연결 요청이 취소되었습니다.");
      const endpoint = "/session/" + encodeURIComponent(sessionId);
      await fitLoginWindow(endpoint);
      await driver("POST", endpoint + "/url", { url: loginUrl });
      if (!sqlite.prepare("UPDATE aladin_browser_connection SET ready=1 WHERE owner_id=? AND generation=?")
        .run(ownerId, generation).changes) throw new AppError("연결 요청이 취소되었습니다.");
    } catch (error) {
      await removeConnection(ownerId, { sessionId, generation, ready: 0 });
      throw error;
    }
  });
}

export async function disconnectStockBrowser(ownerId: number, username: string) {
  if (!canConnectBrowser(username)) throw new AppError("브라우저 연결 권한이 없습니다.", "FORBIDDEN", 403);
  return withBrowserSlot(async () => {
    const current = connection(ownerId);
    if (current) await removeConnection(ownerId, current);
  });
}

export function withStockBrowser<T>(ownerId: number, read: () => Promise<T>): Promise<T> | undefined {
  const current = connection(ownerId);
  if (current?.ready && current.sessionId) return stockBrowser.run({ ownerId, generation:current.generation }, read);
}

// WebDriver runs this in the dedicated browser after the user signs in on Aladin.
// Only a same-origin, bounded catalog GET is available to the worker.
const readCatalog = `
const [address, done] = arguments;
(async () => {
  if (location.origin !== "https://www.aladin.co.kr") return { needsLogin:true };
  const response = await fetch(address, {method:"GET", mode:"same-origin", credentials:"same-origin", redirect:"error",
    cache:"no-store", signal:AbortSignal.timeout(15000)});
  const type = response.headers.get("content-type") || "";
  const result = { status:response.status, type, retry:response.headers.get("retry-after"), html:"" };
  if (!response.ok || !/text\\/html|application\\/xhtml\\+xml/i.test(type)) { await response.body?.cancel(); return result; }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4 * 1024 * 1024) return { oversized:true };
      result.html += decoder.decode(chunk.value,{stream:true});
    }
    result.html += decoder.decode();
    return result;
  } finally { await reader.cancel(); }
})().then(done, () => done({ readFailed:true }));
`;

export async function readStockBrowser(url: URL, checkJob?: () => void): Promise<Response> {
  if (url.origin !== origin || !stockPaths.has(url.pathname.toLowerCase())) throw new AppError("허용되지 않은 알라딘 재고 조회 주소입니다.");
  const active = stockBrowser.getStore();
  const result = await withBrowserSlot(async () => {
    checkJob?.();
    const current = active && connection(active.ownerId);
    if (!active || !current?.ready || !current.sessionId || current.generation !== active.generation) {
      throw new AppError("알라딘 브라우저 연결이 해제되었습니다.", "ALADIN_BROWSER_CLOSED", 409);
    }
    return driver("POST", "/session/" + encodeURIComponent(current.sessionId) + "/execute/async", {
      script: readCatalog, args: [url.href]
    });
  });
  if (result?.needsLogin) throw new AppError("전용 브라우저에서 알라딘 로그인과 성인 인증을 마친 뒤 알라딘 화면을 열어 주세요.", "ALADIN_ADULT_LOGIN_REQUIRED", 422);
  if (result?.oversized || result?.readFailed || !Number.isInteger(result?.status) || typeof result.html !== "string") {
    throw new AppError("전용 브라우저에서 알라딘 재고 페이지를 읽지 못했습니다.", "ALADIN_BROWSER_READ_FAILED", 502);
  }
  return new Response(result.html || null, { status:result.status, headers: {
    "content-type":result.type, ...(result.retry ? {"retry-after":result.retry} : {})
  } });
}
