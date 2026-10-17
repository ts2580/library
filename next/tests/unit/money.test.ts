import { describe, expect, it } from "vitest";
import { isWonInput, normalizeWonInput } from "@/lib/money";

describe("whole won validation", () => {
  it.each([["", null], ["  ", null], ["0", "0"], ["4000", "4000"], [" 4,000 ", "4000"], ["1,000,000", "1000000"]])
    ("normalizes %s without changing its amount", (input, expected) => {
      expect(isWonInput(input!)).toBe(true);
      expect(normalizeWonInput(input!)).toBe(expected);
    });
  it.each(["-1000", "+1000", "1.5", "1e4", "1,00", "12,34,567", "4 000", "가격4000", "9,007,199,254,740,992"])
    ("rejects %s rather than silently coercing it", (input) => {
      expect(isWonInput(input)).toBe(false);
      expect(() => normalizeWonInput(input)).toThrow();
    });
});
