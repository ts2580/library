import { describe, expect, it } from "vitest";
import { largeAladinCover } from "@/features/aladin/cover-url";

describe("large Aladin covers", () => {
  it.each(["coversum", "cover200"])("upgrades %s from Aladin to cover500", size => {
    expect(largeAladinCover(`https://image.aladin.co.kr/product/40246/99/${size}/k672131981_1.jpg`))
      .toBe("https://image.aladin.co.kr/product/40246/99/cover500/k672131981_1.jpg");
  });

  it("preserves other sources, large covers, query parameters and missing covers", () => {
    for (const value of [null, "https://example.com/cover200/image.jpg", "https://image.aladin.co.kr/product/cover500/book.jpg", "https://image.aladin.co.kr/product/book.jpg?path=/cover200/"]) {
      expect(largeAladinCover(value)).toBe(value);
    }
  });
});
