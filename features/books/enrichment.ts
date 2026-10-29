import "server-only";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { isAladinConfigured } from "@/features/aladin/client";
import { searchAladinBooks } from "@/features/aladin/service";
import type { AladinBookItem } from "@/features/aladin/types";
import { normalizeHttpUrl } from "@/lib/urls";

interface Metadata { id: number; name: string | null; author: string | null; description: string | null }
interface VolumeLink { isbn13: string | null; isbn: string | null; link: string | null }
interface Volume extends Metadata, VolumeLink {}
const blank = (value: string | null) => !value?.trim();
const normalizeIsbn = (value: string | null) => value?.replace(/[-\s]/g, "").toUpperCase() ?? "";
const isbnKeys = (volume: Pick<VolumeLink, "isbn13" | "isbn">) => [volume.isbn13, volume.isbn].map(normalizeIsbn).filter(Boolean);
const matchesIsbn = (keys: string[], item: AladinBookItem) => isbnKeys(item).some(key => keys.includes(key));

export async function enrichMissingBookInfo(ownerId: number, bookId: number, { includeLinks = true }: { includeLinks?: boolean } = {}) {
  const book = sqlite.prepare("SELECT id,name,author,description FROM books WHERE id=? AND owner_id=?").get(bookId, ownerId) as Metadata | undefined;
  if (!book) throw new NotFoundError();
  const volumes = sqlite.prepare("SELECT id,name,author,description,isbn13,isbn,link FROM book_volumes WHERE book=? ORDER BY volume IS NULL,volume,id").all(bookId) as Volume[];
  if (!blank(book.author) && !blank(book.description) && volumes.every((volume) => !blank(volume.author) && !blank(volume.description) && (!includeLinks || !blank(volume.link)))) {
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
      const found = (await search(key, "Keyword")).find((item) => matchesIsbn([key], item));
      if (found) return found;
    }
    return items.find((item) => item.title.normalize("NFC").trim() === volume.name?.normalize("NFC").trim()) ?? null;
  }
  const patches: Array<{ id: number; item: AladinBookItem }> = [];
  let bookSource: AladinBookItem | undefined;
  for (const volume of volumes) {
    if (!blank(volume.author) && !blank(volume.description) && (!includeLinks || !blank(volume.link)) && (bookSource || (!blank(book.author) && !blank(book.description)))) continue;
    const item = await match(volume);
    if (item) {
      bookSource ??= item;
      patches.push({ id: volume.id, item });
    }
  }
  if (!bookSource && (blank(book.author) || blank(book.description))) {
    bookSource = (await search(book.name)).find((item) => item.author || item.description);
  }
  return sqlite.transaction(() => {
    const currentBook = sqlite.prepare("SELECT author,description FROM books WHERE id=? AND owner_id=?").get(bookId, ownerId) as Pick<Metadata, "author" | "description"> | undefined;
    if (!currentBook) throw new NotFoundError();
    const fill = (current: string | null, source?: string | null) => blank(current) ? source?.trim() || current : current;
    const author = fill(currentBook.author, bookSource?.author), description = fill(currentBook.description, bookSource?.description);
    const booksUpdated = author !== currentBook.author || description !== currentBook.description
      ? sqlite.prepare("UPDATE books SET author=?,description=? WHERE id=? AND owner_id=?").run(author, description, bookId, ownerId).changes : 0;
    const currentVolume = sqlite.prepare("SELECT isbn13,isbn,link,author,description FROM book_volumes WHERE id=? AND book=?");
    const updateVolume = sqlite.prepare("UPDATE book_volumes SET author=?,description=?,link=? WHERE id=? AND book=?");
    let volumesUpdated = 0;
    for (const { id, item } of patches) {
      // Recheck under the write lock: both the ISBN and link may have changed during lookup.
      const current = currentVolume.get(id, bookId) as (VolumeLink & Pick<Metadata, "author" | "description">) | undefined;
      if (!current) continue;
      const keys = isbnKeys(current);
      // Use the same JavaScript whitespace rules as the initial enrichment check.
      const link = includeLinks && blank(current.link) && (!keys.length || matchesIsbn(keys, item)) ? normalizeHttpUrl(item.link) ?? current.link : current.link;
      const author = fill(current.author, item.author), description = fill(current.description, item.description);
      if (author !== current.author || description !== current.description || link !== current.link) volumesUpdated += updateVolume.run(author, description, link, id, bookId).changes;
    }
    return { booksUpdated, volumesUpdated, summary: booksUpdated || volumesUpdated
      ? `정보 보강 완료: 책 ${booksUpdated}건, 권 ${volumesUpdated}건` : "채울 수 있는 알라딘 정보가 없습니다." };
  }).immediate();
}
