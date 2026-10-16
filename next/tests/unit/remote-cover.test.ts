import { afterAll, afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import dns from "node:dns/promises";
import https from "node:https";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-cover-dns-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "unused.sqlite");
const { persistCover, storedCoverPath } = await import("@/features/covers/service");
afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it.each([true, false])("downloads and normalizes a cover with Node lookup all=%s", async (all) => {
  vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  const picture = await sharp({ create: { width: 10, height: 20, channels: 3, background: "blue" } }).png().toBuffer();
  const request = vi.spyOn(https, "request").mockImplementation(((_url: unknown, options: { lookup: Function }, callback: Function) => {
    const emitter = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn(), end: () => {
      options.lookup("covers.example.com", { all }, (error: unknown, address: unknown, family?: number) => {
        expect(error).toBeNull();
        expect(address).toEqual(all ? [{ address: "93.184.216.34", family: 4 }] : "93.184.216.34");
        if (!all) expect(family).toBe(4);
        callback(Object.assign(Readable.from([picture]), { statusCode: 200, headers: { "content-type": "image/png" } }));
      });
    } });
    return emitter;
  }) as never);
  const reference = await persistCover({ ownerId: 1, key: "remote", remoteUrl: "https://covers.example.com/book.png" });
  expect(request).toHaveBeenCalledOnce();
  expect(existsSync(storedCoverPath(reference!)!)).toBe(true);
});

it("still rejects a private address before opening a connection", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
  const request = vi.spyOn(https, "request");
  await expect(persistCover({ ownerId: 1, key: "unsafe", remoteUrl: "https://covers.example.com/book.png" })).rejects.toThrow("사설망");
  expect(request).not.toHaveBeenCalled();
});
