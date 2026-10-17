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
  if (value instanceof Date) return value.toISOString();
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
  if (value == null || ["0", "false", "no", "n", "아니오"].includes(value.toLowerCase())) return 0;
  if (["1", "true", "yes", "y", "예", "완료", "구매"].includes(value.toLowerCase())) return 1;
  throw new AppError("구매·외전 여부는 예/아니오 또는 true/false로 입력해 주세요.");
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
    { header: "volume", key: "volume", width: 10 },
    { header: "name", key: "name", width: 45 },
    { header: "author", key: "author", width: 28 },
    { header: "isbn13", key: "isbn13", width: 18 },
    { header: "isbn10", key: "isbn10", width: 16 },
    { header: "type", key: "type", width: 18 },
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
    SELECT bv.id AS sourceId, bv.book AS bookSourceId, bv.seq, bv.volume,
           bv.name, bv.author, bv.isbn13, bv.isbn AS isbn10, bv.type, bv.price, bv.ispurchased AS isPurchased,
           bv.noneedtobuy AS noNeedToBuy, bv.description, bv.link, bv.pubdate AS pubDate,
           bv.cover, bv.originalUrl, bv.createddate AS createdDate
    FROM book_volumes bv JOIN books b ON b.id = bv.book
    WHERE b.owner_id = ? ORDER BY bv.book, bv.id
  `).all(ownerId);
  for (const row of volumeRows) volumeSheet.addRow(row);
  volumeSheet.getRow(1).font = { bold: true };
  volumeSheet.autoFilter = "A1:R1";

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
  const bookSheet = workbook.getWorksheet("Books") ?? workbook.getWorksheet("도서");
  const volumeSheet = workbook.getWorksheet("Volumes") ?? workbook.getWorksheet("권");
  if (!bookSheet || !volumeSheet) throw new AppError("Books·Volumes 또는 기존 도서·권 시트가 필요합니다.");
  function requireHeaders(sheet: ExcelJS.Worksheet, groups: string[][]) {
    const headers = (sheet.getRow(1).values as CellValue[]).map((value) => plain(value)?.toLowerCase());
    const named = headers.filter(Boolean);
    if (new Set(named).size !== named.length) throw new AppError(`${sheet.name} 시트에 중복된 헤더가 있습니다.`);
    for (const names of groups) if (!names.some((name) => headers.includes(name.toLowerCase()))) {
      throw new AppError(`${sheet.name} 시트에 ${names[0]} 열이 필요합니다.`);
    }
  }
  requireHeaders(bookSheet, [["source_id", "id", "도서키"], ["name", "책 제목", "title", "제목"]]);
  requireHeaders(volumeSheet, [["book_source_id", "book", "bookId", "도서키"], ["name", "권 제목", "title", "제목"]]);
  const volumeHeaders = (volumeSheet.getRow(1).values as CellValue[]).map((value) => plain(value)?.toLowerCase());
  const hasVolumeColumn = ["volume", "권차", "권번호"].some((name) => volumeHeaders.includes(name));
  const hasSeparateSeq = hasVolumeColumn && volumeHeaders.includes("seq");
  if (bookSheet.rowCount > MAX_WORKBOOK_ROWS || volumeSheet.rowCount > MAX_WORKBOOK_ROWS) {
    throw new AppError("백업 엑셀의 행 수가 제한을 초과했습니다.");
  }

  const bookData = rows(bookSheet);
  const volumeData = rows(volumeSheet);
  const sourceMap = new Map<string, number>();
  const counters = { booksCreated: 0, booksUpdated: 0, volumesCreated: 0, volumesUpdated: 0 };

  const transaction = sqlite.transaction(() => {
    const claimedBooks = new Set<number>();
    const claimedVolumes = new Set<number>();
    const volumeKeys = new Set<string>();
    const volumesByBook = new Map<string, RowObject[]>();
    for (const row of volumeData) {
      const key = pick(row, "source_id", "id", "권키");
      if (key && volumeKeys.has(key)) throw new AppError("중복된 권 키가 있습니다.");
      if (key) volumeKeys.add(key);
      const bookKey = pick(row, "book_source_id", "book", "bookId", "도서키") ?? "";
      const group = volumesByBook.get(bookKey) ?? []; group.push(row); volumesByBook.set(bookKey, group);
    }
    const booksByIsbn = new Map<string, Set<number>>();
    for (const row of sqlite.prepare(`SELECT bv.book,bv.isbn13,bv.isbn FROM book_volumes bv JOIN books b ON b.id=bv.book WHERE b.owner_id=?`)
      .all(ownerId) as Array<{ book: number; isbn13: string | null; isbn: string | null }>) {
      for (const isbn of [row.isbn13, row.isbn]) if (isbn) {
        const ids = booksByIsbn.get(isbn) ?? new Set<number>(); ids.add(row.book); booksByIsbn.set(isbn, ids);
      }
    }
    for (const row of bookData) {
      const sourceId = pick(row, "source_id", "id", "도서키");
      const name = pick(row, "name", "책 제목", "title", "제목");
      if (!sourceId || !name) throw new AppError("도서의 키와 제목은 필수입니다.");
      if (sourceMap.has(sourceId)) throw new AppError("중복된 도서 키가 있습니다.");
      const author = pick(row, "author", "저자");
      const matches = new Set<number>();
      for (const volume of volumesByBook.get(sourceId) ?? []) {
        for (const isbn of [pick(volume, "isbn13"), pick(volume, "isbn10", "isbn")]) {
          for (const id of isbn ? booksByIsbn.get(isbn) ?? [] : []) matches.add(id);
        }
      }
      if (matches.size > 1) throw new AppError(`도서 '${name}'의 ISBN이 여러 기존 도서에 연결되어 있어 병합할 수 없습니다.`);
      const matchedId = [...matches][0];
      if (matchedId && claimedBooks.has(matchedId)) throw new AppError("여러 엑셀 도서가 같은 기존 ISBN 도서를 가리킵니다.");
      const existing = matchedId ? { id: matchedId } : (sqlite.prepare(`
        SELECT id FROM books
        WHERE owner_id = ? AND name = ? AND (author = ? OR (author IS NULL AND ? IS NULL))
        ORDER BY id
      `).all(ownerId, name, author, author) as Array<{ id: number }>).find((item) => !claimedBooks.has(item.id));
      const values = [
        name, author, pick(row, "description", "설명"), pick(row, "type", "카테고리", "분류"),
        pick(row, "totalvolume", "totalVolume", "총권수"),
        normalizeImportedCoverReference(ownerId, pick(row, "cover", "표지")),
        pick(row, "createddate", "createdDate", "등록일") ?? new Date().toISOString()
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
      claimedBooks.add(id);
      const type = values[3];
      if (type) sqlite.prepare("INSERT OR IGNORE INTO book_categories(name) VALUES (?)").run(type);
    }

    for (const row of volumeData) {
      const bookSourceId = pick(row, "book_source_id", "book", "bookId", "도서키");
      const bookId = bookSourceId ? sourceMap.get(bookSourceId) : undefined;
      if (!bookId) throw new AppError("권 시트에 도서 시트에서 찾을 수 없는 도서 키가 있습니다.");
      const isbn13 = pick(row, "isbn13", "ISBN13");
      const isbn10 = pick(row, "isbn10", "isbn", "ISBN10");
      const name = pick(row, "name", "권 제목", "title", "제목") ?? "제목 없음";
      // An explicitly blank volume is a side story, not a fallback to legacy seq.
      const volumeRaw = hasVolumeColumn ? pick(row, "volume", "권차", "권번호") : pick(row, "seq");
      if (volumeRaw && (!/^\d+$/.test(volumeRaw) || !Number.isSafeInteger(Number(volumeRaw)))) throw new AppError("권 번호는 0 이상의 정수여야 합니다.");
      const special = bool(pick(row, "외전"));
      if (special && volumeRaw && Number(volumeRaw) > 0) throw new AppError("외전의 권 번호는 비워 주세요.");
      const volume = special ? null : volumeRaw ? Number(volumeRaw) : bookSheet.name === "도서" ? 0 : null;
      const seqRaw = hasSeparateSeq ? pick(row, "seq") : null;
      if (seqRaw && (!/^-?\d+$/.test(seqRaw) || !Number.isSafeInteger(Number(seqRaw)))) throw new AppError("seq는 정수여야 합니다.");
      const seq = hasSeparateSeq ? seqRaw == null ? null : Number(seqRaw) : volume;
      let existing: { id: number } | undefined;
      if (isbn13 || isbn10) {
        existing = sqlite.prepare(`
          SELECT id FROM book_volumes
          WHERE book = ? AND ((? IS NOT NULL AND isbn13 = ?) OR (? IS NOT NULL AND isbn = ?)) ORDER BY id
        `).all(bookId, isbn13, isbn13, isbn10, isbn10).find((item) => !claimedVolumes.has((item as { id: number }).id)) as { id: number } | undefined;
      }
      existing ??= sqlite.prepare(`
        SELECT id FROM book_volumes WHERE book = ? AND name = ? AND COALESCE(volume, -1) = COALESCE(?, -1) ORDER BY id
      `).all(bookId, name, volume).find((item) => !claimedVolumes.has((item as { id: number }).id)) as { id: number } | undefined;
      const values = [
        bookId, seq, volume, name, pick(row, "author", "저자"), isbn13, isbn10, pick(row, "type", "분류"),
        pick(row, "price", "가격"), bool(pick(row, "ispurchased", "isPurchased", "구매완료")),
        bool(pick(row, "noneedtobuy", "noNeedToBuy", "구매불필요")),
        pick(row, "description", "설명"), normalizeHttpUrl(pick(row, "link", "링크", "상품링크")),
        pick(row, "pubdate", "pubDate", "출간일"),
        normalizeImportedCoverReference(ownerId, pick(row, "cover", "표지")),
        normalizeHttpUrl(pick(row, "originalUrl", "original_url", "원본URL")),
        pick(row, "createddate", "createdDate", "등록일") ?? new Date().toISOString()
      ];
      if (existing) {
        const previous = sqlite.prepare("SELECT book,volume,isbn13,isbn FROM book_volumes WHERE id=?").get(existing.id) as { book: number; volume: number | null; isbn13: string | null; isbn: string | null };
        sqlite.prepare(`UPDATE branchbook SET book_volume_id=? WHERE book_volume_id IS NULL AND book=? AND volume=?
          AND 1=(SELECT COUNT(*) FROM book_volumes candidate WHERE candidate.book=branchbook.book AND candidate.volume=branchbook.volume)`)
          .run(existing.id, previous.book, previous.volume);
        if ((previous.isbn13 || previous.isbn) !== (isbn13 || isbn10)) {
          sqlite.prepare("DELETE FROM branchbook WHERE book_volume_id=?").run(existing.id);
        } else {
          sqlite.prepare("UPDATE branchbook SET book=?,volume=? WHERE book_volume_id=?").run(bookId, volume, existing.id);
        }
        sqlite.prepare(`
          UPDATE book_volumes SET book = ?, seq = ?, volume = ?, name = ?, author = ?, isbn13 = ?, isbn = ?, type = ?,
            price = ?, ispurchased = ?, noneedtobuy = ?, description = ?, link = ?, pubdate = ?,
            cover = ?, originalUrl = ?, createddate = ?, cover_generated = 0
          WHERE id = ?
        `).run(...values, existing.id);
        counters.volumesUpdated += 1;
        claimedVolumes.add(existing.id);
      } else {
        const inserted = sqlite.prepare(`
          INSERT INTO book_volumes(book, seq, volume, name, author, isbn13, isbn, type, price, ispurchased,
            noneedtobuy, description, link, pubdate, cover, originalUrl, createddate, cover_generated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(...values);
        claimedVolumes.add(Number(inserted.lastInsertRowid));
        counters.volumesCreated += 1;
      }
    }
  });
  transaction.immediate();

  return {
    ...counters,
    summary: `도서 ${counters.booksCreated}개 생성·${counters.booksUpdated}개 갱신, 권 ${counters.volumesCreated}개 생성·${counters.volumesUpdated}개 갱신`
  };
}
