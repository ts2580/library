import "server-only";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { isAladinConfigured } from "@/features/aladin/client";
import { searchAladinBooks } from "@/features/aladin/service";
import type { AladinBookItem } from "@/features/aladin/types";

interface Metadata { id: number; name: string | null; author: string | null; description: string | null }
interface Volume extends Metadata { isbn13: string | null; isbn: string | null }
const blank = (value: string | null) => !value?.trim();

export async function enrichMissingBookInfo(ownerId: number, bookId: number) {
  const book = sqlite.prepare("SELECT id,name,author,description FROM books WHERE id=? AND owner_id=?").get(bookId, ownerId) as Metadata | undefined;
  if (!book) throw new NotFoundError();
  const volumes = sqlite.prepare("SELECT id,name,author,description,isbn13,isbn FROM book_volumes WHERE book=? ORDER BY volume IS NULL,volume,id").all(bookId) as Volume[];
  if (!blank(book.author) && !blank(book.description) && volumes.every((volume) => !blank(volume.author) && !blank(volume.description))) {
    return { booksUpdated: 0, volumesUpdated: 0, summary: "채울 저자/설명이 없습니다." };
  }
  if (!isAladinConfigured()) throw new AppError("알라딘 검색을 설정한 뒤 다시 시도해 주세요.");
  const cache = new Map<string, AladinBookItem[]>();
  async function search(query: string | null) {
    const key = query?.trim();
    if (!key) return [];
    if (!cache.has(key)) cache.set(key, (await searchAladinBooks({ query: key.slice(0, 200), page: 1 })).items);
    return cache.get(key)!;
  }
  async function match(volume: Volume) {
    const items = await search(volume.name);
    const keys = [volume.isbn13, volume.isbn].filter(Boolean);
    const exact = items.find((item) => keys.some((key) => key === item.isbn13 || key === item.isbn));
    if (exact) return exact;
    const named = items.find((item) => item.title.normalize("NFC").trim() === volume.name?.normalize("NFC").trim());
    if (named) return named;
    for (const key of keys) {
      const found = (await search(key)).find((item) => key === item.isbn13 || key === item.isbn);
      if (found) return found;
    }
    return null;
  }
  const patches: Array<{ id: number; item: AladinBookItem }> = [];
  let bookSource: AladinBookItem | undefined;
  for (const volume of volumes) {
    if (!blank(volume.author) && !blank(volume.description) && (bookSource || (!blank(book.author) && !blank(book.description)))) continue;
    const item = await match(volume);
    if (item) { bookSource ??= item; patches.push({ id: volume.id, item }); }
  }
  if (!bookSource && (blank(book.author) || blank(book.description))) {
    bookSource = (await search(book.name)).find((item) => item.author || item.description);
  }
  return sqlite.transaction(() => {
    if (!sqlite.prepare("SELECT id FROM books WHERE id=? AND owner_id=?").get(bookId, ownerId)) throw new NotFoundError();
    const updateBook = sqlite.prepare(`UPDATE books SET
      author=CASE WHEN TRIM(COALESCE(author,''))='' THEN COALESCE(?,author) ELSE author END,
      description=CASE WHEN TRIM(COALESCE(description,''))='' THEN COALESCE(?,description) ELSE description END
      WHERE id=? AND owner_id=? AND ((TRIM(COALESCE(author,''))='' AND ? IS NOT NULL) OR (TRIM(COALESCE(description,''))='' AND ? IS NOT NULL))`);
    const updateVolume = sqlite.prepare(`UPDATE book_volumes SET
      author=CASE WHEN TRIM(COALESCE(author,''))='' THEN COALESCE(?,author) ELSE author END,
      description=CASE WHEN TRIM(COALESCE(description,''))='' THEN COALESCE(?,description) ELSE description END
      WHERE id=? AND book=? AND ((TRIM(COALESCE(author,''))='' AND ? IS NOT NULL) OR (TRIM(COALESCE(description,''))='' AND ? IS NOT NULL))`);
    const author = bookSource?.author?.trim() || null;
    const description = bookSource?.description?.trim() || null;
    const booksUpdated = updateBook.run(author, description, bookId, ownerId, author, description).changes;
    let volumesUpdated = 0;
    for (const { id, item } of patches) {
      const author = item.author?.trim() || null, description = item.description?.trim() || null;
      volumesUpdated += updateVolume.run(author, description, id, bookId, author, description).changes;
    }
    return { booksUpdated, volumesUpdated, summary: booksUpdated || volumesUpdated
      ? `정보 보강 완료: 책 ${booksUpdated}건, 권 ${volumesUpdated}건` : "채울 수 있는 알라딘 정보가 없습니다." };
  }).immediate();
}
