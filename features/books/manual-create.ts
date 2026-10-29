import "server-only";
import { z } from "zod";
import { sqlite } from "@/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { createBook } from "@/features/books/service";
import { bookInputSchema } from "@/features/books/validation";
import { searchAladinBooks } from "@/features/aladin/service";
import { importAladinSelection } from "@/features/aladin/bulk-import";
import { bulkSelectionSchema } from "@/features/aladin/selection";
import { isAladinConfigured } from "@/features/aladin/client";

const requestSchema = z.object({
  book: bookInputSchema,
  direct: z.boolean(),
  targetBookId: z.number().int().positive().nullable(),
  preserveSelectionOrder: z.boolean().default(false),
  selection: z.array(z.object({ page: z.number().int().min(1).max(50), key: z.string().min(1).max(32), sideStory: z.boolean().optional() })).max(1000)
});

export async function createManualBook(ownerId: number, raw: unknown, coverFile?: File | null) {
  const input = requestSchema.parse(raw);
  // Retain raw strings: bookInputSchema transforms empty fields to null.
  const book = (raw as { book: unknown }).book;
  if (input.targetBookId != null && !sqlite.prepare("SELECT id FROM books WHERE id = ? AND owner_id = ?").get(input.targetBookId, ownerId)) {
    throw new NotFoundError("추가할 책을 찾을 수 없습니다.");
  }
  if (input.direct) {
    if (input.targetBookId != null) throw new AppError("알라딘 외 등록은 새 책에만 사용할 수 있습니다.");
    return { bookId: await createBook(ownerId, book, coverFile), count: 0 };
  }
  if (!isAladinConfigured()) throw new AppError("알라딘 검색을 설정하거나 책 수동 추가 탭을 이용해 주세요.");
  if (!input.selection.length) {
    const result = await searchAladinBooks({ query: input.book.name, page: 1 });
    if (input.targetBookId != null || result.items.length) throw new AppError("추가할 알라딘 항목을 하나 이상 선택해 주세요.");
    return { bookId: await createBook(ownerId, book, coverFile), count: 0 };
  }
  const selection = bulkSelectionSchema.parse({ query: input.book.name, seriesName: input.book.name,
    targetBookId: input.targetBookId, sideStory: false, selection: input.selection, preserveSelectionOrder: input.preserveSelectionOrder });
  return importAladinSelection(ownerId, selection, { book, coverFile });
}
