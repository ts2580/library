package com.example.bookshelf.user.backup;

import com.example.bookshelf.user.model.Member;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BookshelfBackupServiceTest {

    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbcTemplate;
    private BookshelfBackupService service;

    @BeforeEach
    void setUp() {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);
        jdbcTemplate = new JdbcTemplate(dataSource);
        service = new BookshelfBackupService(new BookshelfBackupRepository(jdbcTemplate));

        jdbcTemplate.update("INSERT INTO member (id, username, password_hash) VALUES (1, 'source', 'pw')");
        jdbcTemplate.update("INSERT INTO member (id, username, password_hash) VALUES (2, 'target', 'pw')");
        jdbcTemplate.update("""
                INSERT INTO books (id, owner_id, name, author, type, totalvolume, description, cover, createddate, cover_generated)
                VALUES (10, 1, '시리즈', '저자', '만화', '2', '도서 설명', '/covers/book.jpg', '2026-01-01 10:00:00', 1)
                """);
        jdbcTemplate.update("""
                INSERT INTO book_volumes (
                    id, book, volume, seq, isbn13, isbn, name, author, type, price, ispurchased,
                    noneedtobuy, description, cover, originalUrl, link, pubdate, createddate, cover_generated
                ) VALUES (
                    20, 10, 1, 1, '9781234567890', '1234567890', '시리즈 1권', '저자', '만화', '12000', 1,
                    0, '권 설명', '/covers/volume.jpg', 'https://example.com/original', 'https://example.com/item',
                    '2025-12-01', '2026-01-01 10:01:00', 1
                )
                """);
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void exportAndImport_restoresDataToSuppliedCurrentOwner_andMarksCoversPending() throws Exception {
        byte[] backup = service.exportBackup(new Member(1, "source", "pw", null, null, null));

        try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(backup))) {
            assertThat(workbook.getSheet("안내").getRow(0).getCell(1).getStringCellValue())
                    .isEqualTo("bookshelf-excel-backup");
            assertThat(workbook.getSheet("도서").getRow(1).getCell(1).getStringCellValue()).isEqualTo("시리즈");
            assertThat(workbook.getSheet("권").getRow(1).getCell(4).getStringCellValue()).isEqualTo("9781234567890");
        }

        var result = service.importBackup(2, "backup.xlsx", backup.length, new ByteArrayInputStream(backup));

        assertThat(result.insertedBooks()).isEqualTo(1);
        assertThat(result.insertedVolumes()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books WHERE owner_id = 1", Integer.class)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books WHERE owner_id = 2", Integer.class)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT owner_id FROM books WHERE id = (SELECT book FROM book_volumes WHERE isbn13 = '9781234567890' ORDER BY id DESC LIMIT 1)", Integer.class)).isEqualTo(2);
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM books WHERE owner_id = 2", Integer.class)).isZero();
        assertThat(jdbcTemplate.queryForObject("SELECT bv.cover_generated FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE b.owner_id = 2", Integer.class)).isZero();

        var secondResult = service.importBackup(2, "backup.xlsx", backup.length, new ByteArrayInputStream(backup));
        assertThat(secondResult.updatedBooks()).isEqualTo(1);
        assertThat(secondResult.updatedVolumes()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books WHERE owner_id = 2", Integer.class)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE b.owner_id = 2", Integer.class)).isEqualTo(1);
    }

    @Test
    void import_allowsMissingVolumeCountsAndPreservesZeroAsUnnumberedStandardVolume() throws Exception {
        byte[] backup = service.exportBackup(new Member(1, "source", "pw", null, null, null));
        byte[] backupWithMissingCounts;
        try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(backup));
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            workbook.getSheet("도서").getRow(1).getCell(4).setBlank();
            workbook.getSheet("권").getRow(1).getCell(2).setCellValue("0");
            workbook.getSheet("권").getRow(1).getCell(3).setCellValue("아니오");
            workbook.write(output);
            backupWithMissingCounts = output.toByteArray();
        }

        var result = service.importBackup(
                2,
                "backup.xlsx",
                backupWithMissingCounts.length,
                new ByteArrayInputStream(backupWithMissingCounts)
        );

        assertThat(result.insertedBooks()).isEqualTo(1);
        assertThat(result.insertedVolumes()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT totalvolume FROM books WHERE owner_id = 2", String.class
        )).isNull();
        assertThat(jdbcTemplate.queryForObject("""
                SELECT bv.volume
                FROM book_volumes bv
                JOIN books b ON b.id = bv.book
                WHERE b.owner_id = 2
                """, Integer.class)).isZero();
    }

    @Test
    void import_preservesBlankSequenceAsUnnumberedStandardVolume() throws Exception {
        byte[] backup = service.exportBackup(new Member(1, "source", "pw", null, null, null));
        byte[] backupWithBlankSequence;
        try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(backup));
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            workbook.getSheet("권").getRow(1).getCell(2).setBlank();
            workbook.getSheet("권").getRow(1).getCell(3).setCellValue("아니오");
            workbook.write(output);
            backupWithBlankSequence = output.toByteArray();
        }

        service.importBackup(
                2,
                "backup.xlsx",
                backupWithBlankSequence.length,
                new ByteArrayInputStream(backupWithBlankSequence)
        );

        assertThat(jdbcTemplate.queryForObject("""
                SELECT bv.volume
                FROM book_volumes bv
                JOIN books b ON b.id = bv.book
                WHERE b.owner_id = 2
                """, Integer.class)).isZero();
    }

    @Test
    void export_writesZeroSequenceAsUnnumberedStandardVolume() throws Exception {
        jdbcTemplate.update("UPDATE book_volumes SET volume = 0, seq = 0 WHERE id = 20");

        byte[] backup = service.exportBackup(new Member(1, "source", "pw", null, null, null));

        try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(backup))) {
            assertThat(workbook.getSheet("권").getRow(1).getCell(2).getStringCellValue()).isEmpty();
            assertThat(workbook.getSheet("권").getRow(1).getCell(3).getStringCellValue()).isEqualTo("아니오");
        }
    }

    @Test
    void import_upsertsExistingCurrentOwnerBookByIsbn13BeforeTitleAndAuthor() {
        jdbcTemplate.update("""
                INSERT INTO books (id, owner_id, name, author, cover_generated)
                VALUES (30, 2, '기존의 다른 제목', '기존 저자', 1)
                """);
        jdbcTemplate.update("""
                INSERT INTO book_volumes (id, book, volume, seq, isbn13, name, cover_generated)
                VALUES (40, 30, 99, 99, '9781234567890', '기존 권 제목', 1)
                """);
        byte[] backup = service.exportBackup(new Member(1, "source", "pw", null, null, null));

        var result = service.importBackup(2, "backup.xlsx", backup.length, new ByteArrayInputStream(backup));

        assertThat(result.insertedBooks()).isZero();
        assertThat(result.updatedBooks()).isEqualTo(1);
        assertThat(result.insertedVolumes()).isZero();
        assertThat(result.updatedVolumes()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books WHERE owner_id = 2", Integer.class)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT name FROM books WHERE id = 30", String.class)).isEqualTo("시리즈");
        assertThat(jdbcTemplate.queryForObject("SELECT name FROM book_volumes WHERE id = 40", String.class)).isEqualTo("시리즈 1권");
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM books WHERE id = 30", Integer.class)).isZero();
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM book_volumes WHERE id = 40", Integer.class)).isZero();
    }

    @Test
    void import_rejectsNonXlsxFilesBeforeChangingData() {
        assertThatThrownBy(() -> service.importBackup(
                2, "backup.csv", 4, new ByteArrayInputStream("test".getBytes())
        )).isInstanceOf(BookshelfBackupService.BackupException.class)
                .hasMessageContaining(".xlsx");

        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books WHERE owner_id = 2", Integer.class)).isZero();
    }

    @Test
    void localCoverLookup_isScopedToCurrentOwner() {
        jdbcTemplate.update("""
                INSERT INTO books (id, owner_id, name, cover)
                VALUES (30, 2, '다른 사용자 책', '/covers/other-user.jpg')
                """);
        BookshelfBackupRepository repository = new BookshelfBackupRepository(jdbcTemplate);

        assertThat(repository.findLocalCoverUrlsForOwner(1))
                .containsExactly("/covers/book.jpg", "/covers/volume.jpg");
        assertThat(repository.findLocalCoverUrlsForOwner(2))
                .containsExactly("/covers/other-user.jpg");
    }

    @Test
    void markingRestoredCoverGenerated_isScopedToCurrentOwner() {
        jdbcTemplate.update("UPDATE books SET cover_generated = 0 WHERE id = 10");
        jdbcTemplate.update("UPDATE book_volumes SET cover_generated = 0 WHERE id = 20");
        jdbcTemplate.update("""
                INSERT INTO books (id, owner_id, name, cover, cover_generated)
                VALUES (30, 2, '다른 사용자 책', '/covers/book.jpg', 0)
                """);
        jdbcTemplate.update("""
                INSERT INTO book_volumes (id, book, name, cover, cover_generated)
                VALUES (40, 30, '다른 사용자 권', '/covers/volume.jpg', 0)
                """);
        BookshelfBackupRepository repository = new BookshelfBackupRepository(jdbcTemplate);

        repository.markLocalCoverAvailableForOwner(1, "/covers/book.jpg");
        repository.markLocalCoverAvailableForOwner(1, "/covers/volume.jpg");

        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM books WHERE id = 10", Integer.class)).isOne();
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM book_volumes WHERE id = 20", Integer.class)).isOne();
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM books WHERE id = 30", Integer.class)).isZero();
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM book_volumes WHERE id = 40", Integer.class)).isZero();
    }
}
