package com.example.bookshelf.user.service;

import com.example.bookshelf.user.repository.MemberRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class BookOwnershipMigrationServiceTest {

    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbcTemplate;
    private BookOwnershipMigrationService service;

    @BeforeEach
    void setUp() {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.execute("CREATE TABLE member (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, email TEXT, name TEXT, description TEXT)");
        jdbcTemplate.execute("CREATE TABLE books (id INTEGER PRIMARY KEY, name TEXT)");
        jdbcTemplate.execute("CREATE TABLE book_volumes (id INTEGER PRIMARY KEY, book INTEGER, volume INTEGER, name TEXT, cover TEXT)");
        jdbcTemplate.execute("CREATE TABLE branchbook (id INTEGER PRIMARY KEY, book INTEGER, volume REAL, name TEXT, booklink TEXT, purchaseurl TEXT)");
        jdbcTemplate.update("INSERT INTO member (id, username, password_hash) VALUES (1, 'trstyq', 'hash')");
        jdbcTemplate.update("INSERT INTO books (id, name) VALUES (10, '책1'), (11, '책2')");
        jdbcTemplate.update("INSERT INTO book_volumes (id, book, volume, name) VALUES (100, 10, 1, '책1 1권')");
        jdbcTemplate.update("INSERT INTO branchbook (id, book, volume, name) VALUES (1000, 10, 1, '책1 1권')");
        service = new BookOwnershipMigrationService(jdbcTemplate, new MemberRepository(jdbcTemplate));
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void migrationAddsOwnerColumnAndAssignsEveryExistingBookToTrstyq() {
        assertThat(service.status().ownerColumnPresent()).isFalse();

        var result = service.migrateExistingBooksToAdmin();

        assertThat(result.updatedBooks()).isEqualTo(2);
        assertThat(result.ownerUsername()).isEqualTo("trstyq");
        assertThat(service.status().completed()).isTrue();
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books WHERE owner_id = 1", Integer.class)).isEqualTo(2);
        assertThat(jdbcTemplate.queryForObject("SELECT book_volume_id FROM branchbook WHERE id = 1000", Integer.class)).isEqualTo(100);
    }

    @Test
    void migrationIsIdempotent() {
        service.migrateExistingBooksToAdmin();

        var second = service.migrateExistingBooksToAdmin();

        assertThat(second.updatedBooks()).isZero();
        assertThat(second.totalBooks()).isEqualTo(2);
    }

    @Test
    void migrationUsesAladinItemIdToResolveSameTitleAndVolumeVariants() {
        jdbcTemplate.update("INSERT INTO book_volumes (id, book, volume, name, cover) VALUES (110, 11, 2, '같은 제목', 'https://image.aladin.co.kr/product/848/98/cover500/a.jpg'), (111, 11, 2, '같은 제목', 'https://image.aladin.co.kr/product/477/14/cover500/b.jpg')");
        jdbcTemplate.update("INSERT INTO branchbook (id, book, volume, name, booklink) VALUES (1100, 11, 2, '같은 제목', 'https://www.aladin.co.kr/used?ItemId=4771403')");

        service.migrateExistingBooksToAdmin();

        assertThat(jdbcTemplate.queryForObject("SELECT book_volume_id FROM branchbook WHERE id = 1100", Integer.class)).isEqualTo(111);
    }
}
