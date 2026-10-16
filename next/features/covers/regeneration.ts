import "server-only";
import fs from "node:fs";
import { sqlite } from "@/db";
import { aladinJson, isAladinConfigured } from "@/features/aladin/client";
import { searchAladinBooks } from "@/features/aladin/service";
import { deleteCoverIfUnused, persistCover, storedCoverPath } from "@/features/covers/service";
import { logger } from "@/lib/logger";
import { normalizeHttpUrl } from "@/lib/urls";

interface PendingVolume {
  id: number;
  bookId: number;
  name: string | null;
  isbn13: string | null;
  cover: string | null;
  originalUrl: string | null;
  generated: number;
}

interface PendingBook {
  id: number;
  name: string | null;
  cover: string | null;
  generated: number;
}

interface CoverCandidate {
  cover: string | null;
}

export interface CoverRegenerationResult {
  pendingBooks: number;
  generatedBooks: number;
  pendingVolumes: number;
  generatedVolumes: number;
  failed: number;
  summary: string;
}

function localCoverExists(reference: string | null): boolean {
  if (!reference) return false;
  const target = storedCoverPath(reference);
  return target != null && fs.existsSync(target) && fs.statSync(target).isFile();
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function lookupCoverByIsbn(isbn13: string): Promise<string | null> {
  if (!isAladinConfigured()) return null;
  try {
    const raw = object(await aladinJson("ItemLookUp.aspx", {
      ItemId: isbn13,
      itemIdType: isbn13.length === 10 ? "ISBN" : "ISBN13",
      Cover: "Big"
    }));
    const first = Array.isArray(raw?.item) ? object(raw.item[0]) : null;
    return stringValue(first?.cover)?.replace(/coversum/gi, "cover500") ?? null;
  } catch (error) {
    logger.warn("Aladin cover lookup by ISBN failed", {
      isbn13,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function lookupCoverByTitle(title: string): Promise<string | null> {
  if (!isAladinConfigured()) return null;
  try {
    const result = await searchAladinBooks({ query: title, page: 1 });
    return result.items.find((item) => item.cover)?.cover ?? null;
  } catch (error) {
    logger.warn("Aladin cover lookup by title failed", {
      title,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function candidateCover(input: { current: string | null; originalUrl?: string | null; isbn13?: string | null; title?: string | null }): Promise<string | null> {
  const external = normalizeHttpUrl(input.current) ?? normalizeHttpUrl(input.originalUrl ?? null);
  if (external) return external;
  if (input.isbn13) {
    const byIsbn = await lookupCoverByIsbn(input.isbn13);
    if (byIsbn) return byIsbn;
  }
  return input.title ? lookupCoverByTitle(input.title) : null;
}

function updateVolumeCover(ownerId: number, volumeId: number, reference: string): boolean {
  return sqlite.prepare(`
    UPDATE book_volumes SET cover = ?, cover_generated = 1
    WHERE id = ? AND book IN (SELECT id FROM books WHERE owner_id = ?)
  `).run(reference, volumeId, ownerId).changes === 1;
}

function updateBookCover(ownerId: number, bookId: number, reference: string): boolean {
  return sqlite.prepare("UPDATE books SET cover = ?, cover_generated = 1 WHERE id = ? AND owner_id = ?")
    .run(reference, bookId, ownerId).changes === 1;
}

export async function regeneratePendingCovers(ownerId: number): Promise<CoverRegenerationResult> {
  const pendingVolumes = sqlite.prepare(`
    SELECT bv.id, bv.book AS bookId, bv.name, COALESCE(bv.isbn13, bv.isbn) AS isbn13, bv.cover, bv.originalUrl, bv.cover_generated AS generated
    FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ?
    ORDER BY bv.id
  `).all(ownerId) as PendingVolume[];
  const pendingBooks = sqlite.prepare(`
    SELECT id, name, cover, cover_generated AS generated FROM books
    WHERE owner_id = ?
    ORDER BY id
  `).all(ownerId) as PendingBook[];
  const volumesToRestore = pendingVolumes.filter((item) => !item.generated || !localCoverExists(item.cover));
  const booksToRestore = pendingBooks.filter((item) => !item.generated || !localCoverExists(item.cover));

  const generatedVolumeReferences = new Map<number, string>();
  let generatedVolumes = 0;
  let generatedBooks = 0;

  for (const volume of volumesToRestore) {
    if (localCoverExists(volume.cover)) {
      if (updateVolumeCover(ownerId, volume.id, volume.cover!)) {
        generatedVolumes += 1;
        generatedVolumeReferences.set(volume.bookId, volume.cover!);
      }
      continue;
    }
    try {
      const source = await candidateCover({ current: volume.cover, originalUrl: volume.originalUrl, isbn13: volume.isbn13, title: volume.name });
      if (!source) continue;
      const next = await persistCover({ ownerId, key: volume.isbn13 ?? `volume-${volume.id}`, remoteUrl: source });
      if (!next) continue;
      if (updateVolumeCover(ownerId, volume.id, next)) {
        generatedVolumes += 1;
        generatedVolumeReferences.set(volume.bookId, next);
        if (volume.cover !== next) deleteCoverIfUnused(volume.cover);
      } else {
        deleteCoverIfUnused(next);
      }
    } catch (error) {
      logger.warn("Volume cover regeneration failed", {
        ownerId,
        volumeId: volume.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const book of booksToRestore) {
    if (localCoverExists(book.cover)) {
      if (updateBookCover(ownerId, book.id, book.cover!)) generatedBooks += 1;
      continue;
    }
    try {
      let next = generatedVolumeReferences.get(book.id) ?? null;
      if (!next) {
        const existing = sqlite.prepare(`
          SELECT bv.cover
          FROM book_volumes bv
          WHERE bv.book = ? AND bv.cover IS NOT NULL AND COALESCE(bv.cover_generated, 0) = 1
          ORDER BY CASE WHEN bv.volume IS NULL THEN 1 ELSE 0 END, bv.volume, bv.id
        `).all(book.id) as CoverCandidate[];
        next = existing.find((candidate) => localCoverExists(candidate.cover))?.cover ?? null;
      }
      if (!next) {
        const primary = sqlite.prepare(`
          SELECT isbn13, name FROM book_volumes
          WHERE book = ? ORDER BY CASE WHEN volume IS NULL THEN 1 ELSE 0 END, volume, id LIMIT 1
        `).get(book.id) as { isbn13: string | null; name: string | null } | undefined;
        const source = await candidateCover({
          current: book.cover,
          isbn13: primary?.isbn13,
          title: book.name ?? primary?.name
        });
        if (source) next = await persistCover({ ownerId, key: primary?.isbn13 ? `${primary.isbn13}-book-${book.id}` : `book-${book.id}`, remoteUrl: source });
      }
      if (!next) continue;
      if (updateBookCover(ownerId, book.id, next)) {
        generatedBooks += 1;
        if (book.cover !== next) deleteCoverIfUnused(book.cover);
      } else if (!generatedVolumeReferences.has(book.id)) {
        deleteCoverIfUnused(next);
      }
    } catch (error) {
      logger.warn("Book cover regeneration failed", {
        ownerId,
        bookId: book.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const failed = (booksToRestore.length - generatedBooks) + (volumesToRestore.length - generatedVolumes);
  return {
    pendingBooks: booksToRestore.length,
    generatedBooks,
    pendingVolumes: volumesToRestore.length,
    generatedVolumes,
    failed,
    summary: `커버 재생성 완료: 도서 ${generatedBooks}/${booksToRestore.length}건, 권 ${generatedVolumes}/${volumesToRestore.length}건${failed ? ` (실패 ${failed}건은 다음 실행에서 재시도)` : ""}`
  };
}
