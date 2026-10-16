import "server-only";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { bookCategories, books } from "@/db/schema";
import { AppError, NotFoundError } from "@/lib/errors";
import { deleteCoverIfUnused, persistCover } from "@/features/covers/service";
import { bookInputSchema, volumeInputSchema, volumeIdsSchema } from "@/features/books/validation";

function category(value: string | null): void {
  if (value) db.insert(bookCategories).values({ name: value }).onConflictDoNothing().run();
}

export async function createBook(ownerId: number, raw: unknown, coverFile?: File | null): Promise<number> {
  const input = bookInputSchema.parse(raw);
  const cover = await persistCover({ ownerId, key: `book-${input.name}`, file: coverFile, remoteUrl: input.coverUrl });
  try {
    const transaction = sqlite.transaction(() => {
      const result = sqlite.prepare(`
        INSERT INTO books(name, author, description, type, totalvolume, cover, owner_id, cover_generated, createddate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.name, input.author, input.description, input.type, input.totalVolume, cover, ownerId, cover ? 1 : 0, new Date().toISOString());
      category(input.type);
      return Number(result.lastInsertRowid);
    });
    return transaction.immediate();
  } catch (error) {
    deleteCoverIfUnused(cover);
    throw error;
  }
}

export async function updateBook(ownerId: number, bookId: number, raw: unknown, coverFile?: File | null): Promise<void> {
  const input = bookInputSchema.parse(raw);
  const current = db.select({ cover: books.cover }).from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId))).get();
  if (!current) throw new NotFoundError();
  const nextCover = coverFile?.size || input.coverUrl
    ? await persistCover({ ownerId, key: `book-${bookId}`, file: coverFile, remoteUrl: input.coverUrl })
    : current.cover;
  try {
    const transaction = sqlite.transaction(() => {
      const result = sqlite.prepare(`
        UPDATE books SET name = ?, author = ?, description = ?, type = ?, totalvolume = ?,
          cover = ?, cover_generated = ?
        WHERE id = ? AND owner_id = ?
      `).run(input.name, input.author, input.description, input.type, input.totalVolume,
        nextCover, nextCover ? 1 : 0, bookId, ownerId);
      if (result.changes !== 1) throw new NotFoundError();
      category(input.type);
    });
    transaction.immediate();
  } catch (error) {
    if (nextCover !== current.cover) deleteCoverIfUnused(nextCover);
    throw error;
  }
  if (current.cover !== nextCover) deleteCoverIfUnused(current.cover);
}

export function deleteBook(ownerId: number, bookId: number): void {
  const current = sqlite.prepare("SELECT cover FROM books WHERE id = ? AND owner_id = ?")
    .get(bookId, ownerId) as { cover: string | null } | undefined;
  if (!current) throw new NotFoundError();
  const volumeCovers = (sqlite.prepare(`
    SELECT bv.cover FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE bv.book = ? AND b.owner_id = ?
  `).all(bookId, ownerId) as Array<{ cover: string | null }>).map((row) => row.cover);
  const transaction = sqlite.transaction(() => {
    const result = sqlite.prepare("DELETE FROM books WHERE id = ? AND owner_id = ?").run(bookId, ownerId);
    if (result.changes !== 1) throw new NotFoundError();
  });
  transaction.immediate();
  deleteCoverIfUnused(current.cover);
  for (const cover of volumeCovers) deleteCoverIfUnused(cover);
}

function assertUniqueIsbn(ownerId: number, isbn13: string | null, exceptVolumeId?: number): void {
  if (!isbn13) return;
  const duplicate = sqlite.prepare(`
    SELECT 1 AS ok FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ? AND bv.isbn13 = ? AND (? IS NULL OR bv.id <> ?) LIMIT 1
  `).get(ownerId, isbn13, exceptVolumeId ?? null, exceptVolumeId ?? null) as { ok: number } | undefined;
  if (duplicate) throw new AppError("같은 ISBN13의 권이 이미 등록되어 있습니다.");
}

export async function addVolume(ownerId: number, bookId: number, raw: unknown, coverFile?: File | null): Promise<number> {
  const input = volumeInputSchema.parse(raw);
  const book = sqlite.prepare("SELECT id FROM books WHERE id = ? AND owner_id = ?").get(bookId, ownerId) as { id: number } | undefined;
  if (!book) throw new NotFoundError();
  assertUniqueIsbn(ownerId, input.isbn13);
  const cover = await persistCover({ ownerId, key: input.isbn13 ?? `volume-${bookId}`, file: coverFile, remoteUrl: input.coverUrl });
  try {
    const transaction = sqlite.transaction(() => {
      const stillOwned = sqlite.prepare("SELECT 1 AS ok FROM books WHERE id = ? AND owner_id = ?").get(bookId, ownerId);
      if (!stillOwned) throw new NotFoundError();
      assertUniqueIsbn(ownerId, input.isbn13);
      const result = sqlite.prepare(`
        INSERT INTO book_volumes(book, seq, volume, name, author, isbn13, price, description, link,
          pubdate, cover, originalUrl, ispurchased, noneedtobuy, cover_generated, createddate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(bookId, input.seq, input.seq, input.name, input.author, input.isbn13, input.price,
        input.description, input.link, input.pubDate, cover, input.coverUrl,
        input.isPurchased ? 1 : 0, input.noNeedToBuy ? 1 : 0, cover ? 1 : 0, new Date().toISOString());
      if (cover) sqlite.prepare("UPDATE books SET cover=?, cover_generated=1 WHERE id=? AND owner_id=? AND (cover IS NULL OR TRIM(cover)='')").run(cover, bookId, ownerId);
      return Number(result.lastInsertRowid);
    });
    return transaction.immediate();
  } catch (error) {
    deleteCoverIfUnused(cover);
    throw error;
  }
}

export async function updateVolume(ownerId: number, bookId: number, volumeId: number, raw: unknown, coverFile?: File | null): Promise<void> {
  const input = volumeInputSchema.parse(raw);
  const current = sqlite.prepare(`
    SELECT bv.cover, bv.volume AS seq, bv.originalUrl
    FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE bv.id = ? AND bv.book = ? AND b.owner_id = ?
  `).get(volumeId, bookId, ownerId) as { cover: string | null; seq: number | null; originalUrl: string | null } | undefined;
  if (!current) throw new NotFoundError("권 정보를 찾을 수 없습니다.");
  assertUniqueIsbn(ownerId, input.isbn13, volumeId);
  const nextCover = coverFile?.size || input.coverUrl
    ? await persistCover({ ownerId, key: input.isbn13 ?? `volume-${volumeId}`, file: coverFile, remoteUrl: input.coverUrl })
    : current.cover;
  try {
    const transaction = sqlite.transaction(() => {
      assertUniqueIsbn(ownerId, input.isbn13, volumeId);
      // Resolve legacy stock links before changing the canonical volume number.
      sqlite.prepare(`
        UPDATE branchbook SET book_volume_id = ?
        WHERE book_volume_id IS NULL AND book = ? AND volume = ?
          AND 1 = (SELECT COUNT(*) FROM book_volumes candidate
                   WHERE candidate.book = branchbook.book AND candidate.volume = branchbook.volume)
      `).run(volumeId, bookId, current.seq);
      const result = sqlite.prepare(`
        UPDATE book_volumes SET seq = ?, volume = ?, name = ?, author = ?, isbn13 = ?, price = ?,
          description = ?, link = ?, pubdate = ?, cover = ?, originalUrl = ?, ispurchased = ?,
          noneedtobuy = ?, cover_generated = ?
        WHERE id = ? AND book = ? AND book IN (SELECT id FROM books WHERE owner_id = ?)
      `).run(input.seq, input.seq, input.name, input.author, input.isbn13, input.price,
        input.description, input.link, input.pubDate, nextCover, coverFile?.size ? null : input.coverUrl ?? current.originalUrl,
        input.isPurchased ? 1 : 0, input.noNeedToBuy ? 1 : 0, nextCover ? 1 : 0,
        volumeId, bookId, ownerId);
      if (result.changes !== 1) throw new NotFoundError();
      if (input.type !== undefined) {
        sqlite.prepare("UPDATE books SET type=? WHERE id=? AND owner_id=?").run(input.type, bookId, ownerId);
        category(input.type);
      }
      if (current.seq !== input.seq) {
        sqlite.prepare("UPDATE branchbook SET volume = ? WHERE book_volume_id = ?").run(input.seq, volumeId);
      }
    });
    transaction.immediate();
  } catch (error) {
    if (nextCover !== current.cover) deleteCoverIfUnused(nextCover);
    throw error;
  }
  if (current.cover !== nextCover) deleteCoverIfUnused(current.cover);
}

export function deleteVolume(ownerId: number, bookId: number, volumeId: number): void {
  deleteVolumes(ownerId, bookId, [volumeId]);
}

export function deleteVolumes(ownerId: number, bookId: number, rawIds: unknown): number {
  const ids = [...new Set(volumeIdsSchema.parse(rawIds))];
  const placeholders = ids.map(() => "?").join(",");
  let covers: Array<{ cover: string | null }> = [];
  const transaction = sqlite.transaction(() => {
    covers = sqlite.prepare(`SELECT bv.cover FROM book_volumes bv JOIN books b ON b.id=bv.book
      WHERE bv.book=? AND b.owner_id=? AND bv.id IN (${placeholders})`).all(bookId, ownerId, ...ids) as Array<{ cover: string | null }>;
    if (covers.length !== ids.length) throw new NotFoundError("삭제할 권을 다시 확인해 주세요.");
    sqlite.prepare(`
      DELETE FROM branchbook
      WHERE book_volume_id IN (${placeholders})
         OR (
           book_volume_id IS NULL
           AND book = ?
           AND volume IN (SELECT volume FROM book_volumes WHERE id IN (${placeholders}))
           AND 1 = (
             SELECT COUNT(*) FROM book_volumes candidate
             WHERE candidate.book = branchbook.book
               AND candidate.volume = branchbook.volume
           )
         )
    `).run(...ids, bookId, ...ids);
    const result = sqlite.prepare(`
      DELETE FROM book_volumes
      WHERE id IN (${placeholders}) AND book = ? AND book IN (SELECT id FROM books WHERE owner_id = ?)
    `).run(...ids, bookId, ownerId);
    if (result.changes !== ids.length) throw new NotFoundError();
  });
  transaction.immediate();
  for (const row of covers) deleteCoverIfUnused(row.cover);
  return ids.length;
}
