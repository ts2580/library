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

  it("orders the screenshot's same-date descending titles by volume number", () => {
    const items = [33, 32, 31, 30].map(volume => ({ title: `츠구모모 ${volume}`, pubDate: volume === 30 ? "2026-09-29" : "2026-09-30" }));
    expect(orderByPublicationDate(items).map(item => item.title)).toEqual(["츠구모모 30", "츠구모모 31", "츠구모모 32", "츠구모모 33"]);
  });

  it("compares title numbers naturally and uses publication dates before titles", () => {
    const items = [
      { title: "시리즈 10", pubDate: "2026-09-30" }, { title: "시리즈 2", pubDate: "2026-09-30" },
      { title: "시리즈 1", pubDate: "2026-10-01" }, { title: "시리즈 99", pubDate: "2026-09-29" }
    ];
    expect(orderByPublicationDate(items).map(item => item.title)).toEqual(["시리즈 99", "시리즈 2", "시리즈 10", "시리즈 1"]);
  });

  it("preserves input order for equal titles and unavailable dates", () => {
    const items = [
      { id: 1, title: "같은 책 2", pubDate: "2026-09-30" }, { id: 2, title: "같은 책 2", pubDate: "2026-09-30" },
      { id: 3, title: "시리즈 10", pubDate: null }, { id: 4, title: "시리즈 2", pubDate: null }
    ];
    expect(orderByPublicationDate(items).map(item => item.id)).toEqual([1, 2, 3, 4]);
  });
});
