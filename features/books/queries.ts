import "server-only";
import { decodeHTMLStrict } from "entities";
import { sqlite } from "@/db";
import { escapeLike } from "@/lib/strings";
import type { BookDetail, BookListFilters, BookListItem, BookListResult, VolumeDetail, BookOption } from "@/features/books/types";

const PAGE_SIZE = 24;

type SqlParam = string | number | null;

export function getManualBookCategories(): string[] {
  return (sqlite.prepare("SELECT name FROM book_categories WHERE TRIM(name) <> '' ORDER BY name COLLATE NOCASE").all() as Array<{ name: string }>).map(({ name }) => name);
}

function normalized(value: string | null | undefined): string | null {
  const v = value?.normalize("NFC").trim();
  return v ? v : null;
}

export function getBookList(ownerId: number, filters: BookListFilters): BookListResult {
  const page = Number.isFinite(filters.page) ? Math.max(1, Math.floor(filters.page!)) : 1;
  const where = ["b.owner_id = ?"];
  const args: SqlParam[] = [ownerId];
  const title = normalized(filters.title);
  const author = normalized(filters.author);
  const type = normalized(filters.type);
  const search = normalized(filters.search);

  if (title) {
    where.push("normalize_nfc(b.name) LIKE ? ESCAPE '!'");
    args.push(`%${escapeLike(title)}%`);
  }
  if (author) {
    where.push("normalize_nfc(b.author) LIKE ? ESCAPE '!'");
    args.push(`%${escapeLike(author)}%`);
  }
  if (type) {
    where.push("b.type = ?");
    args.push(type);
  }
  if (search) {
    where.push("(normalize_nfc(b.name) LIKE ? ESCAPE '!' OR normalize_nfc(b.author) LIKE ? ESCAPE '!')");
    const like = `%${escapeLike(search)}%`;
    args.push(like, like);
  }

  const clause = where.join(" AND ");
  const totalCount = (sqlite.prepare(`SELECT COUNT(*) AS count FROM books b WHERE ${clause}`).get(...args) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const offset = (current - 1) * PAGE_SIZE;

  const rows = sqlite.prepare(`
    SELECT b.id, b.name, b.author, b.description, b.type, b.cover, b.createddate AS createdDate,
           COUNT(bv.id) AS volumeCount
    FROM books b
    LEFT JOIN book_volumes bv ON bv.book = b.id
    WHERE ${clause}
    GROUP BY b.id
    ORDER BY COALESCE(MAX(bv.id), b.id) DESC, b.id DESC
    LIMIT ? OFFSET ?
  `).all(...args, PAGE_SIZE, offset) as BookListItem[];

  const categories = sqlite.prepare(`
    SELECT DISTINCT TRIM(type) AS type
    FROM books
    WHERE owner_id = ? AND type IS NOT NULL AND TRIM(type) <> ''
    ORDER BY type COLLATE NOCASE
  `).all(ownerId).map((row) => (row as { type: string }).type);

  return {
    items: rows.map((row) => ({ ...row, volumeCount: Number(row.volumeCount) })),
    categories,
    page: current,
    pageSize: PAGE_SIZE,
    totalCount,
    totalPages,
    from: totalCount === 0 ? 0 : offset + 1,
    to: Math.min(offset + PAGE_SIZE, totalCount)
  };
}

export function getBookDetail(ownerId: number, bookId: number): BookDetail | null {
  const book = sqlite.prepare(`
    SELECT b.id, b.name, b.author, b.description, b.type, b.cover, b.createddate AS createdDate,
           b.totalvolume AS totalVolume, COUNT(bv.id) AS volumeCount
    FROM books b
    LEFT JOIN book_volumes bv ON bv.book = b.id
    WHERE b.id = ? AND b.owner_id = ?
    GROUP BY b.id
  `).get(bookId, ownerId) as (Omit<BookDetail, "volumes"> | undefined);
  if (!book) return null;

  const volumes = sqlite.prepare(`
    SELECT bv.id, bv.volume AS seq, bv.name, bv.author, bv.isbn13, bv.cover, bv.price,
           bv.description, bv.link, bv.pubdate AS pubDate,
           CAST(COALESCE(bv.ispurchased, 0) AS INTEGER) AS isPurchased,
           CAST(COALESCE(bv.noneedtobuy, 0) AS INTEGER) AS noNeedToBuy,
           COUNT(bb.id) AS stockCount,
           MIN(CASE
             WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> ''
              AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*'
             THEN CAST(REPLACE(bb.price, ',', '') AS INTEGER)
           END) AS minStockPrice
    FROM book_volumes bv
    LEFT JOIN branchbook bb
      ON bb.book_volume_id = bv.id
      OR (
        bb.book_volume_id IS NULL
        AND bb.id IN (
          SELECT legacy.id
          FROM branchbook legacy
          WHERE legacy.book = bv.book
            AND legacy.volume = bv.volume
            AND 1 = (
              SELECT COUNT(*)
              FROM book_volumes candidate
              WHERE candidate.book = legacy.book
                AND candidate.volume = legacy.volume
            )
        )
      )
    WHERE bv.book = ?
    GROUP BY bv.id
    ORDER BY CASE WHEN bv.volume IS NULL THEN 1 ELSE 0 END, bv.volume ASC, bv.id ASC
  `).all(bookId) as Array<Omit<VolumeDetail, "isPurchased" | "noNeedToBuy"> & { isPurchased: number; noNeedToBuy: number }>;

  return {
    ...book,
    description: book.description == null ? null : decodeHTMLStrict(book.description),
    volumeCount: Number(book.volumeCount),
    volumes: volumes.map((volume) => ({
      ...volume,
      description: volume.description == null ? null : decodeHTMLStrict(volume.description),
      stockCount: Number(volume.stockCount),
      minStockPrice: volume.minStockPrice == null ? null : Number(volume.minStockPrice),
      isPurchased: Boolean(volume.isPurchased),
      noNeedToBuy: Boolean(volume.noNeedToBuy)
    }))
  };
}

export function getOwnedBookOptions(ownerId: number, query = "", selectedBookId?: number | null): BookOption[] {
  const like = `%${escapeLike(query.trim())}%`;
  return sqlite.prepare(`
    SELECT id, COALESCE(name, '') AS name, author, type, cover,
      (SELECT COALESCE(MAX(volume), 0) + 1 FROM book_volumes WHERE book = books.id) AS nextVolume
    FROM books
    WHERE owner_id = ? AND (? = '%%' OR normalize_nfc(name) LIKE ? ESCAPE '!' OR normalize_nfc(author) LIKE ? ESCAPE '!')
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id DESC
    LIMIT 20
  `).all(ownerId, like, like, like, selectedBookId ?? null) as BookOption[];
}

export function searchOwnedVolumes(ownerId: number, input: { query?: string; page?: number; sort?: string }) {
  const query = input.query?.normalize("NFC").trim().slice(0, 200) ?? "";
  const like = `%${escapeLike(query)}%`;
  const where = `FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ? AND (normalize_nfc(bv.name) LIKE ? ESCAPE '!' OR bv.isbn13 LIKE ? ESCAPE '!' OR bv.isbn LIKE ? ESCAPE '!'
      OR normalize_nfc(b.name) LIKE ? ESCAPE '!')`;
  const args = [ownerId, like, like, like, like];
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n ${where}`).get(...args) as { n: number }).n;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(totalPages, Math.max(1, Math.floor(input.page || 1)));
  const order = input.sort === "name" ? "bv.name COLLATE NOCASE, bv.id"
    : input.sort === "price" ? "CAST(REPLACE(COALESCE(bv.price, '0'), ',', '') AS INTEGER) DESC, bv.id DESC"
    : input.sort === "volume" ? "b.name COLLATE NOCASE, bv.volume IS NULL, bv.volume, bv.id"
    : input.sort === "recent" ? "bv.createddate DESC, bv.id DESC" : "bv.id DESC";
  const items = sqlite.prepare(`SELECT bv.id, bv.book AS bookId, b.name AS bookName, bv.name, bv.volume AS seq,
    COALESCE(NULLIF(bv.isbn13,''),bv.isbn) AS isbn13, bv.cover, bv.price, bv.ispurchased AS isPurchased, bv.noneedtobuy AS noNeedToBuy
    ${where} ORDER BY ${order} LIMIT 20 OFFSET ?`).all(...args, (page - 1) * 20) as Array<{
      id: number; bookId: number; bookName: string | null; name: string | null; seq: number | null;
      isbn13: string | null; cover: string | null; price: string | null; isPurchased: number; noNeedToBuy: number;
    }>;
  return { items, total, totalPages, page, query };
}
