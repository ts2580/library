import { describe, expect, it } from "vitest";
import { abortable } from "@/lib/abortable";

describe("abortable waits", () => {
  it("returns successful values and propagates failures", async () => {
    const controller = new AbortController();
    await expect(abortable(Promise.resolve(42), controller.signal)).resolves.toBe(42);
    await expect(abortable(Promise.reject(new Error("dns failed")), controller.signal)).rejects.toThrow("dns failed");
  });
  it("stops waiting for a lookup that never settles", async () => {
    const controller = new AbortController();
    const promise = abortable(new Promise<never>(() => {}), controller.signal);
    controller.abort(new Error("deadline"));
    await expect(promise).rejects.toThrow("deadline");
  });
  it("handles an already-aborted signal and observes a later rejection", async () => {
    const controller = new AbortController(); controller.abort(new Error("deadline"));
    await expect(abortable(Promise.reject(new Error("late DNS failure")), controller.signal)).rejects.toThrow("deadline");
  });
});
