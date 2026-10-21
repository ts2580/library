import "server-only";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { isAladinConfigured } from "@/features/aladin/client";
import { searchAladinBooks } from "@/features/aladin/service";
import type { AladinBookItem } from "@/features/aladin/types";
import { normalizeHttpUrl } from "@/lib/urls";

interface Metadata { id: number; name: string | null; author: string | null; description: string | null }
interface Volume extends Metadata { isbn13: string | null; isbn: string | null; link: string | null }
const blank = (value: string | null) => !value?.trim();
const isbnKeys = (volume: Volume) => [volume.isbn13, volume.isbn].map(value => value?.trim()).filter((value): value is string => Boolean(value));
const matchesIsbn = (keys: string[], item: AladinBookItem) => keys.some(key => key === item.isbn13 || key === item.isbn);

export async function enrichMissingBookInfo(ownerId: number, bookId: number) {
  const book = sqlite.prepare("SELECT id,name,author,description FROM books WHERE id=? AND owner_id=?").get(bookId, ownerId) as Metadata | undefined;
  if (!book) throw new NotFoundError();
  const volumes = sqlite.prepare("SELECT id,name,author,description,isbn13,isbn,link FROM book_volumes WHERE book=? ORDER BY volume IS NULL,volume,id").all(bookId) as Volume[];
  if (!blank(book.author) && !blank(book.description) && volumes.every((volume) => !blank(volume.author) && !blank(volume.description) && !blank(volume.link))) {
    return { booksUpdated: 0, volumesUpdated: 0, summary: "채울 저자/설명/상품 링크가 없습니다." };
  }
  if (!isAladinConfigured()) throw new AppError("알라딘 검색을 설정한 뒤 다시 시도해 주세요.");
  const cache = new Map<string, AladinBookItem[]>();
  async function search(query: string | null, queryType: "Title" | "Keyword" = "Title") {
    const value = query?.trim();
    if (!value) return [];
    const key = `${queryType}:${value}`;
    if (!cache.has(key)) cache.set(key, (await searchAladinBooks({ query: value.slice(0, 200), queryType, page: 1 })).items);
    return cache.get(key)!;
  }
  async function match(volume: Volume) {
    const items = await search(volume.name);
    const keys = isbnKeys(volume);
    const exact = items.find((item) => matchesIsbn(keys, item));
    if (exact) return exact;
    for (const key of keys) {
      const found = (await search(key, "Keyword")).find((item) => key === item.isbn13 || key === item.isbn);
      if (found) return found;
    }
    return items.find((item) => item.title.normalize("NFC").trim() === volume.name?.normalize("NFC").trim()) ?? null;
  }
  const patches: Array<{ id: number; item: AladinBookItem; link: string | null }> = [];
  let bookSource: AladinBookItem | undefined;
  for (const volume of volumes) {
    if (!blank(volume.author) && !blank(volume.description) && !blank(volume.link) && (bookSource || (!blank(book.author) && !blank(book.description)))) continue;
    const item = await match(volume);
    if (item) {
      bookSource ??= item;
      const keys = isbnKeys(volume);
      // A same-title edition can supply metadata, but must not supply a different ISBN's purchase link.
      const link = !keys.length || matchesIsbn(keys, item) ? normalizeHttpUrl(item.link) : null;
      patches.push({ id: volume.id, item, link });
    }
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
      description=CASE WHEN TRIM(COALESCE(description,''))='' THEN COALESCE(?,description) ELSE description END,
      link=CASE WHEN TRIM(COALESCE(link,''))='' THEN COALESCE(?,link) ELSE link END
      WHERE id=? AND book=? AND ((TRIM(COALESCE(author,''))='' AND ? IS NOT NULL) OR (TRIM(COALESCE(description,''))='' AND ? IS NOT NULL) OR (TRIM(COALESCE(link,''))='' AND ? IS NOT NULL))`);
    const author = bookSource?.author?.trim() || null;
    const description = bookSource?.description?.trim() || null;
    const booksUpdated = updateBook.run(author, description, bookId, ownerId, author, description).changes;
    let volumesUpdated = 0;
    for (const { id, item, link } of patches) {
      const author = item.author?.trim() || null, description = item.description?.trim() || null;
      volumesUpdated += updateVolume.run(author, description, link, id, bookId, author, description, link).changes;
    }
    return { booksUpdated, volumesUpdated, summary: booksUpdated || volumesUpdated
      ? `정보 보강 완료: 책 ${booksUpdated}건, 권 ${volumesUpdated}건` : "채울 수 있는 알라딘 정보가 없습니다." };
  }).immediate();
}
