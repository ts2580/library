import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { boundedFormData } = await import("@/lib/form-data");

describe("bounded multipart requests", () => {
  it("parses valid fields and files with multipart overhead", async () => {
    const data = new FormData(); data.set("payload", "정보"); data.set("file", new File(["cover"], "cover.webp"));
    const parsed = await boundedFormData(new Request("http://localhost", { method: "POST", body: data }), 2048);
    expect(parsed.get("payload")).toBe("정보");
    expect(await (parsed.get("file") as File).text()).toBe("cover");
  });
  it("rejects an oversized Content-Length before reading", async () => {
    const pull = vi.fn();
    const request = new Request("http://localhost", { method: "POST", headers: { "content-length": "10000" },
      body: new ReadableStream({ pull }, { highWaterMark: 0 }), duplex: "half" } as RequestInit);
    await expect(boundedFormData(request, 1024)).rejects.toMatchObject({ status: 413 });
    expect(pull).not.toHaveBeenCalled();
    await request.body?.cancel();
  });
  it.each([undefined, "1"])("bounds a streaming request with Content-Length=%s and cancels the source", async (length) => {
    let reads = 0;
    const cancel = vi.fn();
    const prefix = new TextEncoder().encode('--test\r\nContent-Disposition: form-data; name="file"; filename="large.bin"\r\n\r\n');
    const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(reads === 1 ? prefix : new Uint8Array(512)); }, cancel });
    const headers = new Headers({ "content-type": "multipart/form-data; boundary=test" });
    if (length) headers.set("content-length", length);
    const request = new Request("http://localhost", { method: "POST", headers, body, duplex: "half" } as RequestInit);
    await expect(boundedFormData(request, 1024)).rejects.toMatchObject({ status: 413 });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(reads).toBeLessThan(7);
  });
});
