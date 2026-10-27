import { describe, expect, it } from "vitest";
import { bookDeletedHref, bookDetailHref, bookReturnTo } from "@/features/books/navigation";

describe("book detail return locations", () => {
  it("retains title, author, category and page filters without old feedback", () => {
    const params = new URLSearchParams({ author: "한글 100%_!", type: "분류 A", page: "3", message: "이전 안내", error: "이전 오류", errorCode: "OLD", returnTo: "/other" });
    const target = bookReturnTo(`/books?${params}`);
    const actual = new URL(target, "https://bookshelf.invalid");
    expect(Object.fromEntries(actual.searchParams)).toEqual({ author: "한글 100%_!", type: "분류 A", page: "3" });
  });
  it.each([
    "/products?ownedQ=isbn&ownedSort=name&ownedPage=4&q=aladin&aladinPage=2",
    "/inventory?q=book&page=2", "/inventory/branches/SEOUL?q=book&page=3",
    "/inventory/logs?status=all&page=2", "/dashboard", "/aladin/search?query=book&page=3"
  ])("preserves the known list origin %s", target => {
    expect(bookReturnTo(target)).toBe(target);
  });
  it.each([null, "", "https://evil.example/books", "//evil.example/books", "/\\evil.example/books", "javascript:alert(1)", "/books/145", "/profile", "/books\n?title=test", "/books?title=" + "x".repeat(8192)])("falls back for an invalid return location %s", value => {
    expect(bookReturnTo(value)).toBe("/books");
  });
  it("round-trips literal percent and Unicode values through a detail link and deletion", () => {
    const source = `/books?${new URLSearchParams({ title: "책 100%_!", page: "2", type: "소설" })}`;
    const detail = new URL(bookDetailHref(145, source, { message: "수정 완료" }), "https://bookshelf.invalid");
    expect(detail.pathname).toBe("/books/145");
    expect(detail.searchParams.get("returnTo")).toBe(source);
    const destination = new URL(bookDeletedHref(detail.searchParams.get("returnTo")), "https://bookshelf.invalid");
    expect(Object.fromEntries(destination.searchParams)).toEqual({ title: "책 100%_!", page: "2", type: "소설", message: "책을 삭제했습니다." });
    expect(bookDetailHref(145)).toBe("/books/145");
  });
  it("does not allow a returnTo feedback field to bypass destination validation", () => {
    expect(new URL(bookDetailHref(1, "https://evil.example", { returnTo: "https://evil.example", error: "실패" }), "https://bookshelf.invalid").searchParams.has("returnTo")).toBe(false);
    expect(new URL(bookDeletedHref("https://evil.example"), "https://bookshelf.invalid").pathname).toBe("/books");
  });
});
