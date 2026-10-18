import { describe, expect, it } from "vitest";
import { orderByPublicationDate } from "@/features/aladin/volume-order";

describe("publication date volume ordering", () => {
  it("orders earlier dates first without mutating input, preserving ties", () => {
    const items = [
      { id: "third", pubDate: "2026-07-31" }, { id: "second-a", pubDate: "2026-05-29" },
      { id: "first", pubDate: "2026-03-20" }, { id: "second-b", pubDate: "2026-05-29" }
    ];
    const original = [...items];
    expect(orderByPublicationDate(items).map((item) => item.id)).toEqual(["first", "second-a", "second-b", "third"]);
    expect(items).toEqual(original);
  });

  it("puts missing and invalid dates last in their original order", () => {
    const items = [null, "2025-02-29", "2024-02-29", "2024-13-01", "", "2024-01-01"].map((pubDate, id) => ({ id, pubDate }));
    expect(orderByPublicationDate(items).map((item) => item.id)).toEqual([5, 2, 0, 1, 3, 4]);
  });
});
