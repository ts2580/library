import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { productPage, searchPage, usedPage } from "../fixtures/aladin-pages.mjs";

vi.mock("server-only", () => ({}));
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-browser-test-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "test.sqlite");
process.env.ALADIN_BROWSER_URL = "http://browser.test:4444";
process.env.ALADIN_BROWSER_OWNER = "fixture";
process.env.ALADIN_PAGE_INTERVAL_MS = "0";
const { sqlite } = await import("@/db");
const { lookupUsedStocks } = await import("@/features/aladin/service");
const { connectStockBrowser, disconnectStockBrowser, getStockBrowserStatus, withStockBrowser, readStockBrowser } = await import("@/features/aladin/browser-session");

afterAll(() => { vi.unstubAllGlobals(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

it("uses an isolated browser only for the connected owner's restricted stock lookup", async () => {
  sqlite.exec("INSERT INTO member(id,username,password_hash) VALUES(1,'fixture','unused'),(2,'other','unused')");
  const product = { itemId: "412480", isbn13: "9788989571146", title: "테스트", author: "저자", pubDate: "2000-01-01" };
  const login = "<script>if(confirm('19세 이상만 이용할 수 있는 상품')) location.href='/login/wlogin.aspx?isAdult=1';</script>";
  const privatePages: string[] = [];
  let loginWindowRect;
  vi.stubGlobal("fetch", async (input: URL, options: RequestInit) => {
    if (input.hostname !== "browser.test") return new Response(login, { headers: { "content-type": "text/html" } });
    if (input.pathname === "/session") {
      expect(new Headers(options.headers).get("content-type")).toBe("application/json; charset=utf-8");
      expect(JSON.parse(String(options.body)).capabilities.alwaysMatch).toMatchObject({ browserName: "firefox", "moz:firefoxOptions": {} });
      return Response.json({ value: { sessionId: "fixture-session" } });
    }
    if (input.pathname.endsWith("/window/handles")) return Response.json({ value: ["open"] });
    if (input.pathname.endsWith("/execute/sync")) return Response.json({ value: { width: 1440, height: 900 } });
    if (input.pathname.endsWith("/window/rect")) {
      loginWindowRect = JSON.parse(String(options.body));
    }
    if (!input.pathname.endsWith("/execute/async")) return Response.json({ value: null });
    const url = new URL(JSON.parse(String(options.body)).args[0]);
    privatePages.push(url.pathname);
    const html = url.pathname.includes("wsearchresult") ? searchPage([product])
      : url.pathname.includes("wuseditemall") ? usedPage(product.itemId) : productPage(product);
    return Response.json({ value: { status: 200, type: "text/html", html } });
  });
  const lookup = (owner: number) => lookupUsedStocks(product.isbn13, undefined, "inventory", undefined, owner);
  await expect(connectStockBrowser(2, "other")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await connectStockBrowser(1, "fixture");
  expect(loginWindowRect).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  expect(await getStockBrowserStatus(1)).toBe("connected");
  expect(await lookup(1)).toMatchObject({ successful: true });
  expect(privatePages).toEqual(["/search/wsearchresult.aspx", "/shop/wproduct.aspx", "/shop/UsedShop/wuseditemall.aspx"]);
  expect(sqlite.prepare("SELECT isbn FROM aladin_inventory_product").all()).toEqual([]);
  expect(await lookup(2)).toMatchObject({ successful: false, errorCode: "ALADIN_ADULT_LOGIN_REQUIRED" });
  await disconnectStockBrowser(1, "fixture");
  expect(await lookup(1)).toMatchObject({ successful: false, errorCode: "ALADIN_ADULT_LOGIN_REQUIRED" });
  expect(privatePages).toHaveLength(3);
});

it("replaces a stale ready session but preserves a live session and one that cannot be reached", async () => {
  sqlite.prepare("INSERT OR IGNORE INTO member(id,username,password_hash) VALUES(1,'fixture','unused')").run();
  sqlite.prepare("INSERT INTO aladin_browser_connection(owner_id,generation,session_id,ready,created_at) VALUES(1,'original','expired',1,unixepoch())").run();
  let offline = true;
  const writes: string[] = [];
  vi.stubGlobal("fetch", async (input: URL, options: RequestInit) => {
    if (offline) throw new TypeError("offline");
    if (options.method !== "GET") writes.push(String(options.method) + " " + input.pathname);
    if (input.pathname.startsWith("/session/expired")) {
      return Response.json({ value: { error: "invalid session id" } }, { status: 404 });
    }
    if (input.pathname === "/session") return Response.json({ value: { sessionId: "new" } });
    if (input.pathname.endsWith("/window/handles")) return Response.json({ value: ["login"] });
    return Response.json({ value: null });
  });
  expect(await getStockBrowserStatus(1)).toBe("unavailable");
  await expect(connectStockBrowser(1, "fixture")).rejects.toMatchObject({ code: "ALADIN_BROWSER_OFFLINE" });
  expect(sqlite.prepare("SELECT session_id FROM aladin_browser_connection WHERE owner_id=1").get()).toEqual({ session_id: "expired" });
  offline = false;
  expect(await getStockBrowserStatus(1)).toBe("disconnected");
  await connectStockBrowser(1, "fixture");
  expect(await getStockBrowserStatus(1)).toBe("connected");
  await connectStockBrowser(1, "fixture");
  expect(writes).toEqual(["DELETE /session/expired", "POST /session", "POST /session/new/execute/sync", "POST /session/new/url"]);
  await disconnectStockBrowser(1, "fixture");
});

it("recovers a browser after process death during login navigation and shares its command slot across processes", async () => {
  sqlite.prepare("INSERT OR IGNORE INTO member(id,username,password_hash) VALUES(1,'fixture','unused')").run();
  const url = new URL("https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=412480");
  const commands: string[] = [];
  vi.stubGlobal("fetch", async (input: URL, options: RequestInit) => {
    commands.push(`${options.method} ${input.pathname}`);
    if (input.pathname === "/session") return Response.json({ value: { sessionId: "replacement" } });
    if (input.pathname.endsWith("/execute/async")) return Response.json({ value: { status: 200, type: "text/html", html: "ok" } });
    return Response.json({ value: null });
  });

  function startChild(action: "connect" | "read") {
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e", `
      const browser = require("./features/aladin/browser-session.ts");
      global.fetch = async url => {
        if (url.pathname === "/session") return Response.json({ value: { sessionId: "orphan" } });
        if (url.pathname.endsWith("/execute/sync")) return Response.json({ value: null });
        process.send(url.pathname);
        await new Promise(resolve => process.once("message", resolve));
        return Response.json({ value: { status: 200, type: "text/html", html: "ok" } });
      };
      const work = process.argv[1] === "connect" ? browser.connectStockBrowser(1, "fixture")
        : browser.withStockBrowser(1, () => browser.readStockBrowser(new URL(process.argv[2])));
      Promise.resolve(work).then(() => process.disconnect()).catch(() => process.exit(1));
    `, action, url.href], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
    return { child, entered: once(child, "message"), exited: once(child, "exit") };
  }

  const opening = startChild("connect");
  try {
    expect((await opening.entered)[0]).toBe("/session/orphan/url");
    expect(sqlite.prepare("SELECT session_id,ready FROM aladin_browser_connection WHERE owner_id=1").get())
      .toEqual({ session_id: "orphan", ready: 0 });
    expect(await getStockBrowserStatus(1)).toBe("disconnected");
  } finally {
    opening.child.kill("SIGKILL");
    await opening.exited;
  }
  await connectStockBrowser(1, "fixture");
  expect(commands).toEqual(["DELETE /session/orphan", "POST /session", "POST /session/replacement/execute/sync", "POST /session/replacement/url"]);
  commands.length = 0;
  const reading = startChild("read");
  try {
    expect((await reading.entered)[0]).toBe("/session/replacement/execute/async");
    const waiting = withStockBrowser(1, () => readStockBrowser(url));
    await delay(100);
    expect(commands).toEqual([]);
    reading.child.send("release");
    expect(await (await waiting)?.text()).toBe("ok");
    expect(commands).toEqual(["POST /session/replacement/execute/async"]);
  } finally {
    if (reading.child.exitCode === null && reading.child.signalCode === null) reading.child.kill();
    await reading.exited;
    await disconnectStockBrowser(1, "fixture");
  }
}, 15_000);
