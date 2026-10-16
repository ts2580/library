import "server-only";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { persistCover, deleteCoverIfUnused } from "@/features/covers/service";
import { z } from "zod";
import { isHttpUrl } from "@/lib/urls";

const nullable = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const nullableHttpUrl = z.string().trim().max(2048).transform((value) => value || null)
  .refine(isHttpUrl, "http 또는 https URL만 사용할 수 있습니다.");

export const aladinImportSchema = z.object({
  targetBookId: z.preprocess((value) => value === "" || value == null ? null : Number(value), z.number().int().positive().nullable()),
  title: z.string().trim().min(1).max(500),
  author: nullable(300),
  description: nullable(5000),
  isbn13: z.string().trim().max(32).transform((value) => value || null),
  cover: nullableHttpUrl,
  price: z.preprocess((value) => value === "" || value == null ? null : Number(value), z.number().int().nonnegative().nullable()),
  link: nullableHttpUrl,
  pubDate: nullable(40),
  categoryName: nullable(500),
  sideStory: z.preprocess((value) => value === "on" || value === "true" || value === "1", z.boolean())
});

function categoryLeaf(value: string | null): string | null {
  if (!value) return null;
  const leaf = value.split(">>").at(-1)?.trim() ?? value;
  return leaf.slice(0, 120) || null;
}

export async function importAladinItem(ownerId: number, raw: unknown): Promise<{ bookId: number; volumeId: number }> {
  const input = aladinImportSchema.parse(raw);
  if (input.targetBookId != null) {
    const target = sqlite.prepare("SELECT id FROM books WHERE id = ? AND owner_id = ?").get(input.targetBookId, ownerId) as { id: number } | undefined;
    if (!target) throw new NotFoundError("추가할 책을 찾을 수 없습니다.");
  }
  if (input.isbn13) {
    const duplicate = sqlite.prepare(`
      SELECT 1 AS ok FROM book_volumes bv JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ? AND bv.isbn13 = ? LIMIT 1
    `).get(ownerId, input.isbn13) as { ok: number } | undefined;
    if (duplicate) throw new AppError("같은 ISBN13의 권이 이미 등록되어 있습니다.");
  }

  const cover = await persistCover({ ownerId, key: input.isbn13 ?? input.title, remoteUrl: input.cover });
  try {
    const transaction = sqlite.transaction(() => {
      let bookId = input.targetBookId;
      if (bookId == null) {
        const category = categoryLeaf(input.categoryName);
        const inserted = sqlite.prepare(`
          INSERT INTO books(name, author, description, type, cover, owner_id, cover_generated, createddate)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(input.title, input.author, input.description, category, cover, ownerId, cover ? 1 : 0);
        bookId = Number(inserted.lastInsertRowid);
        if (category) sqlite.prepare("INSERT OR IGNORE INTO book_categories(name) VALUES (?)").run(category);
      }
      const nextSeq = input.sideStory ? null : (sqlite.prepare(`
        SELECT COALESCE(MAX(volume), 0) + 1 AS nextSeq FROM book_volumes WHERE book = ? AND volume IS NOT NULL
      `).get(bookId) as { nextSeq: number }).nextSeq;
      const volume = sqlite.prepare(`
        INSERT INTO book_volumes(book, seq, volume, name, author, isbn13, price, description, link,
          pubdate, cover, originalUrl, ispurchased, noneedtobuy, cover_generated, createddate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, CURRENT_TIMESTAMP)
      `).run(bookId, nextSeq, nextSeq, input.title, input.author, input.isbn13,
        input.price == null ? null : String(input.price), input.description, input.link,
        input.pubDate, cover, input.cover, cover ? 1 : 0);
      sqlite.prepare(`UPDATE books SET totalvolume = (SELECT CAST(COUNT(*) AS TEXT) FROM book_volumes WHERE book = ?) WHERE id = ? AND owner_id = ?`)
        .run(bookId, bookId, ownerId);
      return { bookId, volumeId: Number(volume.lastInsertRowid) };
    });
    return transaction.immediate();
  } catch (error) {
    deleteCoverIfUnused(cover);
    throw error;
  }
}
