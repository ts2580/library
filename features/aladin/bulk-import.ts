import "server-only";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { persistCover, deleteCoverIfUnused } from "@/features/covers/service";
import { searchAladinBooks } from "@/features/aladin/service";
import { bulkSelectionSchema } from "@/features/aladin/selection";
import type { AladinBookItem } from "@/features/aladin/types";
import { bookInputSchema } from "@/features/books/validation";
import { persistAladinCover } from "@/features/aladin/covers";
import { orderByPublicationDate } from "@/features/aladin/volume-order";

export async function importAladinSelection(ownerId: number, raw: unknown, manual?: { book: unknown; coverFile?: File | null }) {
  const input = bulkSelectionSchema.parse(raw);
  const metadata = manual ? bookInputSchema.parse(manual.book) : null;
  function assertTarget() {
    if (input.targetBookId != null && !sqlite.prepare("SELECT id FROM books WHERE id = ? AND owner_id = ?")
      .get(input.targetBookId, ownerId)) throw new NotFoundError("추가할 책을 찾을 수 없습니다.");
  }
  assertTarget();
  let selected: AladinBookItem[] = [];
  const seen = new Set<string>();
  const pages = [...new Set(input.selection.map((item) => item.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const result = await searchAladinBooks({ ...input.searchOptions, query: input.query, page });
    if (result.page !== page || result.pageSize <= 0 || page > Math.min(50, Math.ceil(result.totalResults / result.pageSize))) {
      throw new AppError("선택한 검색 결과 페이지를 다시 확인해 주세요.", "STALE_SELECTION");
    }
    const keys = new Set(input.selection.filter((item) => item.page === page).map((item) => item.key));
    const available = new Set(result.items.map((item) => item.isbn13 ?? item.isbn).filter(Boolean));
    if ([...keys].some((key) => !available.has(key))) {
      throw new AppError("선택한 알라딘 항목이 변경되었습니다. 다시 검색해 주세요.", "STALE_SELECTION");
    }
    // Keep a stable search order for equal or unavailable publication dates.
    for (const item of result.items) {
      const key = item.isbn13 ?? item.isbn;
      if (key && keys.has(key) && !seen.has(key)) { seen.add(key); selected.push(item); }
    }
  }
  if (input.preserveSelectionOrder) {
    const rank = new Map<string, number>();
    input.selection.forEach((entry, index) => { if (!rank.has(entry.key)) rank.set(entry.key, index); });
    selected.sort((a, b) => rank.get((a.isbn13 ?? a.isbn)!)! - rank.get((b.isbn13 ?? b.isbn)!)!);
  } else selected = orderByPublicationDate(selected);
  function assertNoDuplicates() {
    const duplicate = sqlite.prepare(`SELECT 1 FROM book_volumes bv JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ? AND (bv.isbn13 = ? OR bv.isbn = ?) LIMIT 1`);
    for (const item of selected) {
      for (const key of [item.isbn13, item.isbn].filter(Boolean)) {
        if (duplicate.get(ownerId, key, key)) throw new AppError("선택한 ISBN의 권이 이미 등록되어 있습니다.");
      }
    }
  }
  assertNoDuplicates();
  const covers: Array<string | null> = [];
  try {
    for (const item of selected) covers.push(await persistAladinCover(ownerId, item.isbn13 ?? item.title, item.cover));
    const coverFailures = selected.filter((item, index) => item.cover && !covers[index]).length;
    const bookCover = input.targetBookId == null && (manual?.coverFile?.size || metadata?.coverUrl)
      ? await persistCover({ ownerId, key: `book-${input.seriesName}`, remoteUrl: metadata?.coverUrl, file: manual?.coverFile })
      : covers[0];
    if (bookCover && !covers.includes(bookCover)) covers.push(bookCover);
    return sqlite.transaction(() => {
      assertTarget();
      assertNoDuplicates();
      let bookId = input.targetBookId;
      const first = selected[0]!;
      if (bookId == null) {
        const category = metadata ? metadata.type : input.category !== undefined ? input.category || null : first.categoryName?.split(/>+/).at(-1)?.trim().slice(0, 120) || null;
        bookId = Number(sqlite.prepare(`INSERT INTO books(name, author, description, type, totalvolume, cover, owner_id, cover_generated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(metadata?.name ?? input.seriesName, metadata?.author ?? first.author,
            metadata?.description ?? first.description, category, metadata?.totalVolume ?? input.totalVolume ?? null, bookCover, ownerId, bookCover ? 1 : 0).lastInsertRowid);
        if (category) sqlite.prepare("INSERT OR IGNORE INTO book_categories(name) VALUES (?)").run(category);
      }
      let next = input.startVolume ?? (sqlite.prepare("SELECT COALESCE(MAX(volume), 0) + 1 AS value FROM book_volumes WHERE book = ? AND volume IS NOT NULL")
        .get(bookId) as { value: number }).value;
      const insert = sqlite.prepare(`INSERT INTO book_volumes(book, seq, volume, name, author, isbn13, isbn, price,
        description, link, pubdate, cover, originalUrl, cover_generated, ispurchased, noneedtobuy, createddate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP)`);
      selected.forEach((item, index) => {
        const key = item.isbn13 ?? item.isbn;
        const sideStory = input.selection.find((entry) => entry.key === key)?.sideStory ?? input.sideStory;
        const volume = sideStory ? null : next++;
        insert.run(bookId, volume, volume, item.title, item.author, item.isbn13, item.isbn,
          item.priceSales == null ? null : String(item.priceSales), item.description, item.link, item.pubDate,
          covers[index], item.cover, covers[index] ? 1 : 0);
      });
      if (bookCover) sqlite.prepare("UPDATE books SET cover=?, cover_generated=1 WHERE id=? AND owner_id=? AND (cover IS NULL OR TRIM(cover)='')").run(bookCover, bookId, ownerId);
      return { bookId, count: selected.length, coverFailures };
    }).immediate();
  } catch (error) {
    for (const cover of covers) deleteCoverIfUnused(cover);
    throw error;
  }
}
