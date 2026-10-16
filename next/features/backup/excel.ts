import "server-only";
import ExcelJS from "exceljs";
import unzipper from "unzipper";
import { Readable, type Readable as NodeReadable } from "node:stream";
import { sqlite } from "@/db";
import { AppError } from "@/lib/errors";
import { trimToNull } from "@/lib/strings";
import { normalizeImportedCoverReference } from "@/features/covers/service";
import { normalizeHttpUrl } from "@/lib/urls";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const MAX_WORKBOOK_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_WORKBOOK_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_WORKBOOK_ENTRIES = 10_000;
const MAX_WORKBOOK_ROWS = 100_000;

type WorkbookZipEntry = NodeReadable & AsyncIterable<Buffer> & { type: string; path: string; autodrain(): void };

async function validateWorkbookArchive(buffer: Buffer): Promise<void> {
  let entries = 0;
  let expanded = 0;
  const parser = Readable.from(buffer).pipe(unzipper.Parse({ forceStream: true }));
  try {
    for await (const rawEntry of parser) {
      const entry = rawEntry as WorkbookZipEntry;
      entries += 1;
      if (entries > MAX_WORKBOOK_ENTRIES) throw new AppError("엑셀 내부 파일 수가 제한을 초과했습니다.");
      if (entry.type !== "File") {
        entry.autodrain();
        continue;
      }
      let entryBytes = 0;
      for await (const chunk of entry) {
        entryBytes += Buffer.byteLength(chunk);
        expanded += Buffer.byteLength(chunk);
        if (entryBytes > MAX_WORKBOOK_ENTRY_BYTES || expanded > MAX_WORKBOOK_EXPANDED_BYTES) {
          throw new AppError("압축 해제된 엑셀 크기가 허용 범위를 초과했습니다.");
        }
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("올바른 .xlsx 파일이 아닙니다.");
  }
}

export interface ImportSummary {
  booksCreated: number;
  booksUpdated: number;
  volumesCreated: number;
  volumesUpdated: number;
  summary: string;
}

type CellValue = ExcelJS.CellValue;
type RowObject = Record<string, CellValue>;

function plain(value: CellValue): string | null {
  if (value == null) return null;
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return trimToNull(value.text);
    if ("result" in value) return plain(value.result as CellValue);
    if ("richText" in value && Array.isArray(value.richText)) return trimToNull(value.richText.map((item) => item.text).join(""));
  }
  return trimToNull(String(value));
}

function rows(sheet: ExcelJS.Worksheet): RowObject[] {
  const headerRow = sheet.getRow(1);
  const headers = headerRow.values as CellValue[];
  const result: RowObject[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item: RowObject = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = plain(headers[colNumber]);
      if (header) item[header] = cell.value;
    });
    if (Object.values(item).some((value) => plain(value) != null)) result.push(item);
  });
  return result;
}

function pick(row: RowObject, ...keys: string[]): string | null {
  for (const key of keys) {
    const direct = row[key];
    const value = plain(direct);
    if (value != null) return value;
    const found = Object.entries(row).find(([header]) => header.toLowerCase() === key.toLowerCase());
    const fallback = found ? plain(found[1]) : null;
    if (fallback != null) return fallback;
  }
  return null;
}

function bool(value: string | null): number {
  return value && ["1", "true", "yes", "y", "완료", "구매"].includes(value.toLowerCase()) ? 1 : 0;
}

export async function exportExcelBackup(ownerId: number, username: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bookshelf";
  workbook.created = new Date();
  workbook.lastModifiedBy = username;

  const bookSheet = workbook.addWorksheet("Books", { views: [{ state: "frozen", ySplit: 1 }] });
  bookSheet.columns = [
    { header: "source_id", key: "sourceId", width: 12 },
    { header: "name", key: "name", width: 38 },
    { header: "author", key: "author", width: 28 },
    { header: "description", key: "description", width: 60 },
    { header: "type", key: "type", width: 18 },
    { header: "totalvolume", key: "totalVolume", width: 14 },
    { header: "cover", key: "cover", width: 50 },
    { header: "createddate", key: "createdDate", width: 24 }
  ];
  const bookRows = sqlite.prepare(`
    SELECT id AS sourceId, name, author, description, type, totalvolume AS totalVolume, cover, createddate AS createdDate
    FROM books WHERE owner_id = ? ORDER BY id
  `).all(ownerId);
  for (const row of bookRows) bookSheet.addRow(row);
  bookSheet.getRow(1).font = { bold: true };
  bookSheet.autoFilter = "A1:H1";

  const volumeSheet = workbook.addWorksheet("Volumes", { views: [{ state: "frozen", ySplit: 1 }] });
  volumeSheet.columns = [
    { header: "source_id", key: "sourceId", width: 12 },
    { header: "book_source_id", key: "bookSourceId", width: 16 },
    { header: "seq", key: "seq", width: 10 },
    { header: "name", key: "name", width: 45 },
    { header: "author", key: "author", width: 28 },
    { header: "isbn13", key: "isbn13", width: 18 },
    { header: "price", key: "price", width: 14 },
    { header: "ispurchased", key: "isPurchased", width: 14 },
    { header: "noneedtobuy", key: "noNeedToBuy", width: 14 },
    { header: "description", key: "description", width: 60 },
    { header: "link", key: "link", width: 50 },
    { header: "pubdate", key: "pubDate", width: 14 },
    { header: "cover", key: "cover", width: 50 },
    { header: "originalUrl", key: "originalUrl", width: 50 },
    { header: "createddate", key: "createdDate", width: 24 }
  ];
  const volumeRows = sqlite.prepare(`
    SELECT bv.id AS sourceId, bv.book AS bookSourceId, bv.volume AS seq,
           bv.name, bv.author, bv.isbn13, bv.price, bv.ispurchased AS isPurchased,
           bv.noneedtobuy AS noNeedToBuy, bv.description, bv.link, bv.pubdate AS pubDate,
           bv.cover, bv.originalUrl, bv.createddate AS createdDate
    FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ? ORDER BY bv.book, bv.id
  `).all(ownerId);
  for (const row of volumeRows) volumeSheet.addRow(row);
  volumeSheet.getRow(1).font = { bold: true };
  volumeSheet.autoFilter = "A1:O1";

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

export async function importExcelBackup(ownerId: number, file: File): Promise<ImportSummary> {
  if (file.size <= 0 || file.size > MAX_BACKUP_BYTES) throw new AppError("백업 엑셀은 32MB 이하여야 합니다.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new AppError(".xlsx 백업 파일만 업로드할 수 있습니다.");
  if (file.type && ![XLSX_TYPE, "application/octet-stream"].includes(file.type)) {
    throw new AppError(".xlsx 백업 파일만 업로드할 수 있습니다.");
  }
  const source = Buffer.from(await file.arrayBuffer());
  await validateWorkbookArchive(source);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  } catch {
    throw new AppError("올바른 .xlsx 파일이 아닙니다.");
  }
  const bookSheet = workbook.getWorksheet("Books") ?? workbook.worksheets[0];
  const volumeSheet = workbook.getWorksheet("Volumes") ?? workbook.worksheets[1];
  if (!bookSheet || !volumeSheet) throw new AppError("Books와 Volumes 시트가 필요합니다.");
  if (bookSheet.rowCount > MAX_WORKBOOK_ROWS || volumeSheet.rowCount > MAX_WORKBOOK_ROWS) {
    throw new AppError("백업 엑셀의 행 수가 제한을 초과했습니다.");
  }

  const bookData = rows(bookSheet);
  const volumeData = rows(volumeSheet);
  const sourceMap = new Map<string, number>();
  const counters = { booksCreated: 0, booksUpdated: 0, volumesCreated: 0, volumesUpdated: 0 };

  const transaction = sqlite.transaction(() => {
    for (const row of bookData) {
      const sourceId = pick(row, "source_id", "id") ?? `row-${sourceMap.size + 1}`;
      const name = pick(row, "name", "책 제목", "title");
      if (!name) continue;
      const author = pick(row, "author", "저자");
      const existing = sqlite.prepare(`
        SELECT id FROM books
        WHERE owner_id = ? AND name = ? AND (author = ? OR (author IS NULL AND ? IS NULL))
        ORDER BY id LIMIT 1
      `).get(ownerId, name, author, author) as { id: number } | undefined;
      const values = [
        name, author, pick(row, "description", "설명"), pick(row, "type", "카테고리"),
        pick(row, "totalvolume", "totalVolume", "총권수"),
        normalizeImportedCoverReference(ownerId, pick(row, "cover", "표지")),
        pick(row, "createddate", "createdDate") ?? new Date().toISOString()
      ];
      let id: number;
      if (existing) {
        sqlite.prepare(`
          UPDATE books SET name = ?, author = ?, description = ?, type = ?, totalvolume = ?,
            cover = ?, createddate = ?, cover_generated = 0
          WHERE id = ? AND owner_id = ?
        `).run(...values, existing.id, ownerId);
        id = existing.id;
        counters.booksUpdated += 1;
      } else {
        const result = sqlite.prepare(`
          INSERT INTO books(name, author, description, type, totalvolume, cover, createddate, owner_id, cover_generated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(...values, ownerId);
        id = Number(result.lastInsertRowid);
        counters.booksCreated += 1;
      }
      sourceMap.set(sourceId, id);
      const type = values[3];
      if (type) sqlite.prepare("INSERT OR IGNORE INTO book_categories(name) VALUES (?)").run(type);
    }

    for (const row of volumeData) {
      const bookSourceId = pick(row, "book_source_id", "book", "bookId");
      const bookId = bookSourceId ? sourceMap.get(bookSourceId) : undefined;
      if (!bookId) continue;
      const isbn13 = pick(row, "isbn13", "ISBN13");
      const name = pick(row, "name", "권 제목", "title") ?? "제목 없음";
      const seqRaw = pick(row, "seq", "volume", "권차");
      const seq = seqRaw && /^\d+$/.test(seqRaw) ? Number(seqRaw) : null;
      let existing: { id: number } | undefined;
      if (isbn13) {
        existing = sqlite.prepare(`
          SELECT bv.id FROM book_volumes bv JOIN books b ON b.id = bv.book
          WHERE b.owner_id = ? AND bv.isbn13 = ? LIMIT 1
        `).get(ownerId, isbn13) as { id: number } | undefined;
      }
      existing ??= sqlite.prepare(`
        SELECT id FROM book_volumes WHERE book = ? AND name = ? AND COALESCE(volume, -1) = COALESCE(?, -1) LIMIT 1
      `).get(bookId, name, seq) as { id: number } | undefined;
      const values = [
        bookId, seq, seq, name, pick(row, "author", "저자"), isbn13,
        pick(row, "price", "가격"), bool(pick(row, "ispurchased", "isPurchased", "구매완료")),
        bool(pick(row, "noneedtobuy", "noNeedToBuy", "구매불필요")),
        pick(row, "description", "설명"), normalizeHttpUrl(pick(row, "link", "링크")),
        pick(row, "pubdate", "pubDate", "출간일"),
        normalizeImportedCoverReference(ownerId, pick(row, "cover", "표지")),
        normalizeHttpUrl(pick(row, "originalUrl", "original_url")),
        pick(row, "createddate", "createdDate") ?? new Date().toISOString()
      ];
      if (existing) {
        sqlite.prepare(`
          UPDATE book_volumes SET book = ?, seq = ?, volume = ?, name = ?, author = ?, isbn13 = ?,
            price = ?, ispurchased = ?, noneedtobuy = ?, description = ?, link = ?, pubdate = ?,
            cover = ?, originalUrl = ?, createddate = ?, cover_generated = 0
          WHERE id = ?
        `).run(...values, existing.id);
        counters.volumesUpdated += 1;
      } else {
        sqlite.prepare(`
          INSERT INTO book_volumes(book, seq, volume, name, author, isbn13, price, ispurchased,
            noneedtobuy, description, link, pubdate, cover, originalUrl, createddate, cover_generated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(...values);
        counters.volumesCreated += 1;
      }
    }

    sqlite.prepare(`
      UPDATE books SET totalvolume = (
        SELECT CAST(COUNT(*) AS TEXT) FROM book_volumes bv WHERE bv.book = books.id
      ) WHERE owner_id = ?
    `).run(ownerId);
  });
  transaction.immediate();

  return {
    ...counters,
    summary: `도서 ${counters.booksCreated}개 생성·${counters.booksUpdated}개 갱신, 권 ${counters.volumesCreated}개 생성·${counters.volumesUpdated}개 갱신`
  };
}
