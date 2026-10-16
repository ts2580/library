import "server-only";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { persistCover, deleteCoverIfUnused } from "@/features/covers/service";
import { searchAladinBooks } from "@/features/aladin/service";
import { bulkSelectionSchema } from "@/features/aladin/selection";
import type { AladinBookItem } from "@/features/aladin/types";

export async function importAladinSelection(ownerId: number, raw: unknown) {
  const input = bulkSelectionSchema.parse(raw);
  function assertTarget() {
    if (input.targetBookId != null && !sqlite.prepare("SELECT id FROM books WHERE id = ? AND owner_id = ?")
      .get(input.targetBookId, ownerId)) throw new NotFoundError("추가할 책을 찾을 수 없습니다.");
  }
  assertTarget();
  const selected: AladinBookItem[] = [];
  const seen = new Set<string>();
  const pages = [...new Set(input.selection.map((item) => item.page))].sort((a, b) => b - a);
  for (const page of pages) {
    const result = await searchAladinBooks({ query: input.query, page });
    if (result.page !== page || result.pageSize <= 0 || page > Math.min(50, Math.ceil(result.totalResults / result.pageSize))) {
      throw new AppError("선택한 검색 결과 페이지를 다시 확인해 주세요.", "STALE_SELECTION");
    }
    const keys = new Set(input.selection.filter((item) => item.page === page).map((item) => item.key));
    const available = new Set(result.items.map((item) => item.isbn13 ?? item.isbn).filter(Boolean));
    if ([...keys].some((key) => !available.has(key))) {
      throw new AppError("선택한 알라딘 항목이 변경되었습니다. 다시 검색해 주세요.", "STALE_SELECTION");
    }
    // Later pages first; preserve the displayed top-to-bottom order within a page.
    for (const item of result.items) {
      const key = item.isbn13 ?? item.isbn;
      if (key && keys.has(key) && !seen.has(key)) { seen.add(key); selected.push(item); }
    }
  }
  function assertNoDuplicates() {
    const duplicate = sqlite.prepare(`SELECT 1 FROM book_volumes bv JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ? AND bv.isbn13 = ? LIMIT 1`);
    for (const item of selected) {
      if (item.isbn13 && duplicate.get(ownerId, item.isbn13)) throw new AppError("선택한 ISBN13의 권이 이미 등록되어 있습니다.");
    }
  }
  assertNoDuplicates();
  const covers: Array<string | null> = [];
  try {
    for (const item of selected) covers.push(await persistCover({ ownerId, key: item.isbn13 ?? item.title, remoteUrl: item.cover }));
    return sqlite.transaction(() => {
      assertTarget();
      assertNoDuplicates();
      let bookId = input.targetBookId;
      const first = selected[0]!;
      if (bookId == null) {
        const category = first.categoryName?.split(">>").at(-1)?.trim().slice(0, 120) || null;
        bookId = Number(sqlite.prepare(`INSERT INTO books(name, author, description, type, cover, owner_id, cover_generated)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.seriesName, first.author, first.description, category, covers[0], ownerId, covers[0] ? 1 : 0).lastInsertRowid);
        if (category) sqlite.prepare("INSERT OR IGNORE INTO book_categories(name) VALUES (?)").run(category);
      }
      let next = (sqlite.prepare("SELECT COALESCE(MAX(volume), 0) + 1 AS value FROM book_volumes WHERE book = ? AND volume IS NOT NULL")
        .get(bookId) as { value: number }).value;
      const insert = sqlite.prepare(`INSERT INTO book_volumes(book, seq, volume, name, author, isbn13, isbn, price,
        description, link, pubdate, cover, originalUrl, cover_generated, ispurchased, noneedtobuy, createddate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP)`);
      selected.forEach((item, index) => {
        const volume = input.sideStory ? null : next++;
        insert.run(bookId, volume, volume, item.title, item.author, item.isbn13, item.isbn,
          item.priceSales == null ? null : String(item.priceSales), item.description, item.link, item.pubDate,
          covers[index], item.cover, covers[index] ? 1 : 0);
      });
      sqlite.prepare("UPDATE books SET totalvolume = (SELECT CAST(COUNT(*) AS TEXT) FROM book_volumes WHERE book = ?) WHERE id = ? AND owner_id = ?")
        .run(bookId, bookId, ownerId);
      return { bookId, count: selected.length };
    }).immediate();
  } catch (error) {
    for (const cover of covers) deleteCoverIfUnused(cover);
    throw error;
  }
}
