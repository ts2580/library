import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { withRequestGate } from "@/features/aladin/request-gate";
let directory: string, filename: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "aladin-gate-review-"));
  filename = path.join(directory, "gate.sqlite");
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); });

it.each([30_001, 60_000])("waits for the configured %i ms interval without claiming a server cooldown", async interval => {
  await withRequestGate(filename, interval, async () => "first");
  const next = vi.fn(async () => "second");
  const pending = withRequestGate(filename, interval, next).then(value => ({ value, error: null }), error => ({ value: null, error }));
  await vi.advanceTimersByTimeAsync(interval - 1);
  expect(next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual({ value: "second", error: null });
});

it("retains the server cooldown when another caller uses a longer normal interval", async () => {
  await withRequestGate(filename, 1000, async cooldown => { await cooldown(60_000); });
  const next = vi.fn();
  await expect(withRequestGate(filename, 60_000, next)).rejects.toThrow("ALADIN_COOLDOWN");
  expect(next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  await withRequestGate(filename, 60_000, next);
  expect(next).toHaveBeenCalledTimes(1);
});

it("waits for a 60-second normal interval even when the server cooldown is shorter", async () => {
  await withRequestGate(filename, 60_000, async cooldown => { await cooldown(5000); });
  const next = vi.fn();
  const pending = withRequestGate(filename, 60_000, next);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(next).toHaveBeenCalledTimes(1);
});

it.each(["interval", "cooldown"])("preserves the legacy sidecar's pending %s on upgrade", async mode => {
  const db = new Database(filename);
  db.exec("CREATE TABLE request_state (id INTEGER PRIMARY KEY CHECK(id=1), next_at INTEGER NOT NULL)");
  const wait = mode === "interval" ? 60_000 : 120_000;
  db.prepare("INSERT INTO request_state VALUES(1,?)").run(Date.now() + wait); db.close();
  const next = vi.fn(async () => "done");
  const pending = withRequestGate(filename, mode === "interval" ? 60_000 : 1000, next)
    .then(value => ({ value, error: null }), error => ({ value: null, error }));
  if (mode === "cooldown") {
    expect((await pending).error).toMatchObject({ message: "ALADIN_COOLDOWN" });
    expect(next).not.toHaveBeenCalled();
  } else {
    await vi.advanceTimersByTimeAsync(wait - 1); expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toEqual({ value: "done", error: null });
  }
});

it("overlaps slow responses but starts requests at least one interval apart", async () => {
  const starts: number[] = [];
  const releases: Array<() => void> = [];
  const requests = Array.from({length:3}, () => withRequestGate(filename,1000,async()=>{
    starts.push(Date.now());
    await new Promise<void>(resolve=>releases.push(resolve));
  }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(starts).toHaveLength(3);
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000);
  expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1000);
  releases.forEach(release=>release());
  await Promise.all(requests);
});

it("caps requests at ten and admits the next one when a slot is released",async()=>{
  let active=0, peak=0;
  const releases: Array<()=>void> = [];
  const requests=Array.from({length:11},()=>withRequestGate(filename,0,async()=>{
    active++;peak=Math.max(peak,active);
    await new Promise<void>(resolve=>releases.push(resolve));
    active--;
  }));
  await vi.advanceTimersByTimeAsync(100);
  expect(releases).toHaveLength(10);expect(active).toBe(10);
  releases[0]!();
  await vi.advanceTimersByTimeAsync(50);
  expect(releases).toHaveLength(11);expect(active).toBe(10);
  releases.slice(1).forEach(release=>release());
  await Promise.all(requests);
  expect(peak).toBe(10);expect(active).toBe(0);
});

it("does not clear a concurrent 429 cooldown when an older successful request finishes",async()=>{
  let release!:()=>void;
  const older=withRequestGate(filename,0,async()=>new Promise<void>(resolve=>{release=resolve;}));
  await vi.advanceTimersByTimeAsync(0);
  await withRequestGate(filename,0,async cooldown=>{await cooldown(60_000);});
  release();await older;
  await expect(withRequestGate(filename,0,async()=>{})).rejects.toThrow('ALADIN_COOLDOWN');
});

it("does not expire normally queued callers at a configured 60-second interval",async()=>{
  const starts:number[]=[];
  const requests=Array.from({length:4},()=>withRequestGate(filename,60_000,async()=>{starts.push(Date.now());}));
  await vi.advanceTimersByTimeAsync(180_000);
  await Promise.all(requests);
  expect(starts).toHaveLength(4);
  expect(starts[3]!-starts[0]!).toBe(180_000);
});
