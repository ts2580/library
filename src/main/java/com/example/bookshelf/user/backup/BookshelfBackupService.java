package com.example.bookshelf.user.backup;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.user.backup.BookshelfBackupRepository.BackupBook;
import com.example.bookshelf.user.backup.BookshelfBackupRepository.BackupVolume;
import com.example.bookshelf.user.model.Member;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class BookshelfBackupService {

    public static final long MAX_UPLOAD_BYTES = 20L * 1024 * 1024;
    private static final int MAX_BOOK_ROWS = 50_000;
    private static final int MAX_VOLUME_ROWS = 200_000;
    private static final String FORMAT_NAME = "bookshelf-excel-backup";
    private static final String FORMAT_VERSION = "1";
    private static final String INFO_SHEET = "안내";
    private static final String BOOK_SHEET = "도서";
    private static final String VOLUME_SHEET = "권";

    private static final List<String> BOOK_HEADERS = List.of(
            "도서키", "제목", "저자", "분류", "총권수", "설명", "표지", "등록일"
    );
    private static final List<String> VOLUME_HEADERS = List.of(
            "도서키", "권키", "권번호", "외전", "ISBN13", "ISBN10", "제목", "저자", "분류",
            "가격", "구매완료", "구매불필요", "설명", "표지", "원본URL", "상품링크", "출간일", "등록일"
    );

    private final BookshelfBackupRepository repository;

    public BookshelfBackupService(BookshelfBackupRepository repository) {
        this.repository = repository;
    }

    public byte[] exportBackup(Member member) {
        List<BackupBook> books = repository.findBooksForOwner(member.id());
        List<BackupVolume> volumes = repository.findVolumesForOwner(member.id());

        try (XSSFWorkbook workbook = new XSSFWorkbook();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            CellStyle headerStyle = createHeaderStyle(workbook);
            writeInfoSheet(workbook, member, books.size(), volumes.size());
            writeBooksSheet(workbook, headerStyle, books);
            writeVolumesSheet(workbook, headerStyle, volumes);
            workbook.write(output);
            return output.toByteArray();
        } catch (IOException e) {
            throw new BackupException("엑셀 백업 파일을 생성하지 못했습니다.", e);
        }
    }

    @Transactional
    public ImportResult importBackup(int ownerId, String originalFilename, long fileSize, InputStream inputStream) {
        validateUpload(originalFilename, fileSize);
        ParsedBackup parsed = parseWorkbook(inputStream);

        int insertedBooks = 0;
        int updatedBooks = 0;
        int insertedVolumes = 0;
        int updatedVolumes = 0;
        Map<String, Integer> importedBookIds = new LinkedHashMap<>();
        Map<String, List<BackupVolume>> volumesByBookKey = new LinkedHashMap<>();
        for (BackupVolume volume : parsed.volumes()) {
            volumesByBookKey.computeIfAbsent(volume.bookBackupKey(), ignored -> new ArrayList<>()).add(volume);
        }
        Map<String, List<Integer>> existingBookIdsByIsbn13 = repository.findBookIdsByIsbn13ForOwner(ownerId);
        Set<Integer> claimedBookIds = new HashSet<>();
        Set<Integer> claimedVolumeIds = new HashSet<>();

        for (BackupBook book : parsed.books()) {
            Integer bookId = resolveBookIdByIsbn13(
                    book,
                    volumesByBookKey.getOrDefault(book.backupKey(), List.of()),
                    existingBookIdsByIsbn13,
                    claimedBookIds
            );
            if (bookId == null) {
                bookId = firstUnclaimed(
                        repository.findBookIdsForMerge(ownerId, book.name(), book.author()),
                        claimedBookIds
                );
            }
            if (bookId == null) {
                bookId = repository.insertBook(ownerId, book);
                insertedBooks++;
            } else {
                repository.updateBook(bookId, ownerId, book);
                updatedBooks++;
            }
            claimedBookIds.add(bookId);
            importedBookIds.put(book.backupKey(), bookId);
        }

        for (BackupVolume volume : parsed.volumes()) {
            int bookId = importedBookIds.get(volume.bookBackupKey());
            Integer volumeId = firstUnclaimed(repository.findVolumeIdsForMerge(bookId, volume), claimedVolumeIds);
            if (volumeId == null) {
                volumeId = repository.insertVolume(bookId, volume);
                claimedVolumeIds.add(volumeId);
                insertedVolumes++;
            } else {
                repository.updateVolume(volumeId, bookId, volume);
                claimedVolumeIds.add(volumeId);
                updatedVolumes++;
            }
        }

        return new ImportResult(insertedBooks, updatedBooks, insertedVolumes, updatedVolumes);
    }

    private ParsedBackup parseWorkbook(InputStream inputStream) {
        try (XSSFWorkbook workbook = new XSSFWorkbook(inputStream)) {
            validateMetadata(workbook);
            List<BackupBook> books = readBooks(workbook);
            Set<String> bookKeys = new HashSet<>();
            for (BackupBook book : books) {
                if (!bookKeys.add(book.backupKey())) {
                    throw new BackupException("도서 시트에 중복된 도서키가 있습니다: " + book.backupKey());
                }
            }
            List<BackupVolume> volumes = readVolumes(workbook, bookKeys);
            return new ParsedBackup(books, volumes);
        } catch (BackupException e) {
            throw e;
        } catch (Exception e) {
            throw new BackupException("올바른 Bookshelf 엑셀 백업 파일이 아닙니다.", e);
        }
    }

    private void validateUpload(String originalFilename, long fileSize) {
        if (fileSize <= 0) {
            throw new BackupException("업로드할 엑셀 파일을 선택해 주세요.");
        }
        if (fileSize > MAX_UPLOAD_BYTES) {
            throw new BackupException("엑셀 파일은 20MB 이하만 업로드할 수 있습니다.");
        }
        if (originalFilename == null || !originalFilename.toLowerCase(Locale.ROOT).endsWith(".xlsx")) {
            throw new BackupException(".xlsx 형식의 Bookshelf 백업 파일만 업로드할 수 있습니다.");
        }
    }

    private void validateMetadata(XSSFWorkbook workbook) {
        Sheet sheet = requiredSheet(workbook, INFO_SHEET);
        Map<String, String> metadata = new HashMap<>();
        for (Row row : sheet) {
            String key = cellText(row.getCell(0), INFO_SHEET + " 시트 " + (row.getRowNum() + 1) + "행");
            String value = cellText(row.getCell(1), INFO_SHEET + " 시트 " + (row.getRowNum() + 1) + "행");
            if (key != null) {
                metadata.put(key, value);
            }
        }
        if (!FORMAT_NAME.equals(metadata.get("형식")) || !FORMAT_VERSION.equals(metadata.get("버전"))) {
            throw new BackupException("지원하지 않는 Bookshelf 백업 형식 또는 버전입니다.");
        }
    }

    private List<BackupBook> readBooks(XSSFWorkbook workbook) {
        Sheet sheet = requiredSheet(workbook, BOOK_SHEET);
        Map<String, Integer> columns = readHeader(sheet, BOOK_HEADERS);
        if (sheet.getLastRowNum() > MAX_BOOK_ROWS) {
            throw new BackupException("도서 시트는 최대 " + MAX_BOOK_ROWS + "행까지 업로드할 수 있습니다.");
        }

        List<BackupBook> books = new ArrayList<>();
        for (int rowIndex = 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (isBlankRow(row, columns.values())) continue;
            String context = BOOK_SHEET + " 시트 " + (rowIndex + 1) + "행";
            books.add(new BackupBook(
                    requiredText(row, columns, "도서키", context),
                    requiredText(row, columns, "제목", context),
                    optionalText(row, columns, "저자", context),
                    optionalText(row, columns, "분류", context),
                    optionalText(row, columns, "총권수", context),
                    optionalText(row, columns, "설명", context),
                    optionalText(row, columns, "표지", context),
                    optionalText(row, columns, "등록일", context)
            ));
        }
        return books;
    }

    private List<BackupVolume> readVolumes(XSSFWorkbook workbook, Set<String> bookKeys) {
        Sheet sheet = requiredSheet(workbook, VOLUME_SHEET);
        Map<String, Integer> columns = readHeader(sheet, VOLUME_HEADERS);
        if (sheet.getLastRowNum() > MAX_VOLUME_ROWS) {
            throw new BackupException("권 시트는 최대 " + MAX_VOLUME_ROWS + "행까지 업로드할 수 있습니다.");
        }

        List<BackupVolume> volumes = new ArrayList<>();
        Set<String> volumeKeys = new HashSet<>();
        for (int rowIndex = 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (isBlankRow(row, columns.values())) continue;
            String context = VOLUME_SHEET + " 시트 " + (rowIndex + 1) + "행";
            String bookKey = requiredText(row, columns, "도서키", context);
            String volumeKey = requiredText(row, columns, "권키", context);
            if (!bookKeys.contains(bookKey)) {
                throw new BackupException(context + ": 도서 시트에 없는 도서키입니다: " + bookKey);
            }
            if (!volumeKeys.add(volumeKey)) {
                throw new BackupException(context + ": 중복된 권키입니다: " + volumeKey);
            }

            boolean sideStory = parseBoolean(optionalText(row, columns, "외전", context), "외전", context);
            Integer sequence = parseSequence(optionalText(row, columns, "권번호", context), context);
            if (sideStory && sequence != null) {
                throw new BackupException(context + ": 외전인 권은 권번호를 비워 주세요.");
            }
            if (!sideStory && sequence == null) {
                throw new BackupException(context + ": 일반 권은 1 이상의 권번호가 필요합니다.");
            }

            volumes.add(new BackupVolume(
                    bookKey,
                    volumeKey,
                    sideStory ? null : sequence,
                    optionalText(row, columns, "ISBN13", context),
                    optionalText(row, columns, "ISBN10", context),
                    optionalText(row, columns, "제목", context),
                    optionalText(row, columns, "저자", context),
                    optionalText(row, columns, "분류", context),
                    optionalText(row, columns, "가격", context),
                    parseBoolean(optionalText(row, columns, "구매완료", context), "구매완료", context),
                    parseBoolean(optionalText(row, columns, "구매불필요", context), "구매불필요", context),
                    optionalText(row, columns, "설명", context),
                    optionalText(row, columns, "표지", context),
                    optionalText(row, columns, "원본URL", context),
                    optionalText(row, columns, "상품링크", context),
                    optionalText(row, columns, "출간일", context),
                    optionalText(row, columns, "등록일", context)
            ));
        }
        return volumes;
    }

    private Map<String, Integer> readHeader(Sheet sheet, List<String> requiredHeaders) {
        Row row = sheet.getRow(0);
        if (row == null) {
            throw new BackupException(sheet.getSheetName() + " 시트의 헤더가 없습니다.");
        }
        Map<String, Integer> columns = new LinkedHashMap<>();
        for (Cell cell : row) {
            String name = cellText(cell, sheet.getSheetName() + " 시트 헤더");
            if (name != null && columns.put(name, cell.getColumnIndex()) != null) {
                throw new BackupException(sheet.getSheetName() + " 시트에 중복된 헤더가 있습니다: " + name);
            }
        }
        for (String header : requiredHeaders) {
            if (!columns.containsKey(header)) {
                throw new BackupException(sheet.getSheetName() + " 시트에 필수 열이 없습니다: " + header);
            }
        }
        return columns;
    }

    private void writeInfoSheet(XSSFWorkbook workbook, Member member, int bookCount, int volumeCount) {
        Sheet sheet = workbook.createSheet(INFO_SHEET);
        List<List<String>> rows = List.of(
                List.of("형식", FORMAT_NAME),
                List.of("버전", FORMAT_VERSION),
                List.of("사용자", member.username()),
                List.of("내보낸 시각", OffsetDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)),
                List.of("도서 수", Integer.toString(bookCount)),
                List.of("권 수", Integer.toString(volumeCount)),
                List.of("복원 방식", "현재 로그인 사용자의 책장에 병합하며 기존 데이터는 자동 삭제하지 않습니다.")
        );
        for (int i = 0; i < rows.size(); i++) {
            Row row = sheet.createRow(i);
            row.createCell(0).setCellValue(rows.get(i).get(0));
            row.createCell(1).setCellValue(rows.get(i).get(1));
        }
        sheet.setColumnWidth(0, 18 * 256);
        sheet.setColumnWidth(1, 72 * 256);
    }

    private void writeBooksSheet(XSSFWorkbook workbook, CellStyle headerStyle, List<BackupBook> books) {
        Sheet sheet = workbook.createSheet(BOOK_SHEET);
        writeHeader(sheet, BOOK_HEADERS, headerStyle);
        int rowIndex = 1;
        for (BackupBook book : books) {
            Row row = sheet.createRow(rowIndex++);
            writeValues(row,
                    book.backupKey(), book.name(), book.author(), book.type(), book.totalVolume(),
                    book.description(), book.cover(), book.createdDate()
            );
        }
        finishDataSheet(sheet, BOOK_HEADERS.size(), books.size());
    }

    private void writeVolumesSheet(XSSFWorkbook workbook, CellStyle headerStyle, List<BackupVolume> volumes) {
        Sheet sheet = workbook.createSheet(VOLUME_SHEET);
        writeHeader(sheet, VOLUME_HEADERS, headerStyle);
        int rowIndex = 1;
        for (BackupVolume volume : volumes) {
            Row row = sheet.createRow(rowIndex++);
            writeValues(row,
                    volume.bookBackupKey(), volume.backupKey(), value(volume.sequence()),
                    yesNo(volume.sequence() == null), volume.isbn13(), volume.isbn(), volume.name(),
                    volume.author(), volume.type(), volume.price(), yesNo(volume.purchased()),
                    yesNo(volume.noNeedToBuy()), volume.description(), volume.cover(), volume.originalUrl(),
                    volume.link(), volume.publicationDate(), volume.createdDate()
            );
        }
        finishDataSheet(sheet, VOLUME_HEADERS.size(), volumes.size());
    }

    private CellStyle createHeaderStyle(XSSFWorkbook workbook) {
        CellStyle style = workbook.createCellStyle();
        Font font = workbook.createFont();
        font.setBold(true);
        font.setColor(IndexedColors.WHITE.getIndex());
        style.setFont(font);
        style.setFillForegroundColor(IndexedColors.INDIGO.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        return style;
    }

    private void writeHeader(Sheet sheet, List<String> headers, CellStyle style) {
        Row row = sheet.createRow(0);
        for (int i = 0; i < headers.size(); i++) {
            Cell cell = row.createCell(i);
            cell.setCellValue(headers.get(i));
            cell.setCellStyle(style);
            sheet.setColumnWidth(i, columnWidth(headers.get(i)) * 256);
        }
        sheet.createFreezePane(0, 1);
    }

    private void writeValues(Row row, String... values) {
        for (int i = 0; i < values.length; i++) {
            row.createCell(i, CellType.STRING).setCellValue(value(values[i]));
        }
    }

    private void finishDataSheet(Sheet sheet, int columnCount, int dataCount) {
        int lastRow = Math.max(dataCount, 1);
        sheet.setAutoFilter(new org.apache.poi.ss.util.CellRangeAddress(0, lastRow, 0, columnCount - 1));
    }

    private int columnWidth(String header) {
        return switch (header) {
            case "설명", "표지", "원본URL", "상품링크" -> 36;
            case "제목", "저자", "등록일" -> 22;
            default -> 14;
        };
    }

    private Sheet requiredSheet(XSSFWorkbook workbook, String name) {
        Sheet sheet = workbook.getSheet(name);
        if (sheet == null) {
            throw new BackupException("필수 시트가 없습니다: " + name);
        }
        return sheet;
    }

    private boolean isBlankRow(Row row, Iterable<Integer> columns) {
        if (row == null) return true;
        for (Integer column : columns) {
            if (cellText(row.getCell(column), row.getSheet().getSheetName() + " 시트") != null) {
                return false;
            }
        }
        return true;
    }

    private String requiredText(Row row, Map<String, Integer> columns, String name, String context) {
        String value = optionalText(row, columns, name, context);
        if (value == null) {
            throw new BackupException(context + ": " + name + " 값이 필요합니다.");
        }
        return value;
    }

    private String optionalText(Row row, Map<String, Integer> columns, String name, String context) {
        return cellText(row.getCell(columns.get(name)), context + " " + name + " 열");
    }

    private String cellText(Cell cell, String context) {
        if (cell == null || cell.getCellType() == CellType.BLANK) return null;
        if (cell.getCellType() == CellType.FORMULA) {
            throw new BackupException(context + ": 수식 셀은 사용할 수 없습니다.");
        }
        String raw = switch (cell.getCellType()) {
            case STRING -> cell.getStringCellValue();
            case BOOLEAN -> Boolean.toString(cell.getBooleanCellValue());
            case NUMERIC -> BigDecimal.valueOf(cell.getNumericCellValue()).stripTrailingZeros().toPlainString();
            default -> cell.toString();
        };
        return Texts.trimToNull(raw);
    }

    private Integer parseSequence(String raw, String context) {
        if (raw == null) return null;
        try {
            int sequence = new BigDecimal(raw).intValueExact();
            if (sequence < 1) throw new ArithmeticException();
            return sequence;
        } catch (ArithmeticException | NumberFormatException e) {
            throw new BackupException(context + ": 권번호는 1 이상의 정수여야 합니다.");
        }
    }

    private boolean parseBoolean(String raw, String column, String context) {
        if (raw == null) return false;
        return switch (raw.toLowerCase(Locale.ROOT)) {
            case "예", "y", "yes", "true", "1" -> true;
            case "아니오", "n", "no", "false", "0" -> false;
            default -> throw new BackupException(context + ": " + column + " 값은 예 또는 아니오여야 합니다.");
        };
    }

    private Integer firstUnclaimed(List<Integer> candidates, Set<Integer> claimedIds) {
        return candidates.stream().filter(id -> !claimedIds.contains(id)).findFirst().orElse(null);
    }

    private Integer resolveBookIdByIsbn13(BackupBook book,
                                          List<BackupVolume> volumes,
                                          Map<String, List<Integer>> existingBookIdsByIsbn13,
                                          Set<Integer> claimedBookIds) {
        Set<Integer> matchedBookIds = new java.util.LinkedHashSet<>();
        for (BackupVolume volume : volumes) {
            if (volume.isbn13() != null) {
                matchedBookIds.addAll(existingBookIdsByIsbn13.getOrDefault(volume.isbn13(), List.of()));
            }
        }
        if (matchedBookIds.size() > 1) {
            throw new BackupException("도서 '" + book.name() + "'의 ISBN13이 여러 기존 도서에 연결되어 있어 병합할 수 없습니다.");
        }
        if (matchedBookIds.isEmpty()) {
            return null;
        }
        Integer matchedBookId = matchedBookIds.iterator().next();
        if (claimedBookIds.contains(matchedBookId)) {
            throw new BackupException("여러 엑셀 도서가 동일한 기존 ISBN13 도서를 가리켜 병합할 수 없습니다: " + book.name());
        }
        return matchedBookId;
    }

    private static String yesNo(boolean value) {
        return value ? "예" : "아니오";
    }

    private static String value(Object value) {
        return value == null ? "" : value.toString();
    }

    private record ParsedBackup(List<BackupBook> books, List<BackupVolume> volumes) {
    }

    public record ImportResult(int insertedBooks, int updatedBooks, int insertedVolumes, int updatedVolumes) {
        public String summary() {
            return "엑셀 복원 완료: 도서 추가 " + insertedBooks + "건, 갱신 " + updatedBooks
                    + "건 / 권 추가 " + insertedVolumes + "건, 갱신 " + updatedVolumes + "건";
        }
    }

    public static class BackupException extends RuntimeException {
        public BackupException(String message) {
            super(message);
        }

        public BackupException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
