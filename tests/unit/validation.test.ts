import { describe, expect, it } from "vitest";
import { bookInputSchema, volumeInputSchema } from "@/features/books/validation";
import { aladinSearchSchema, isbn13Schema } from "@/features/aladin/validation";

const book = { name: "테스트", author: "", description: "", type: "", totalVolume: "", coverUrl: "" };
describe("input validation", () => {
  it("normalizes optional book fields", () => expect(bookInputSchema.parse(book).author).toBeNull());
  it("rejects contradictory volume flags", () => expect(() => volumeInputSchema.parse({ name: "1권", seq: "1", isbn13: "", author: "", price: "", description: "", link: "", pubDate: "", coverUrl: "", isPurchased: "on", noNeedToBuy: "on" })).toThrow());
  it("limits Aladin pages", () => expect(() => aladinSearchSchema.parse({ query: "책", page: 51 })).toThrow());
  it("checks ISBN shape", () => expect(isbn13Schema.parse("9781234567890")).toBe("9781234567890"));
});
