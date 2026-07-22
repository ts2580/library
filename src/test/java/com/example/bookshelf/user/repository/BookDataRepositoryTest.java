package com.example.bookshelf.user.repository;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class BookDataRepositoryTest {

    @Test
    void findAllBookTypes_readsStoredCategories_notGroupedBookValues() {
        JdbcTemplate jdbcTemplate = new JdbcTemplate(new SingleConnectionDataSource("jdbc:sqlite::memory:", true));
        createSchema(jdbcTemplate);
        jdbcTemplate.update("INSERT INTO book_categories (name) VALUES (?)", "저장된 카테고리");
        jdbcTemplate.update("INSERT INTO books (name, type) VALUES (?, ?)", "책", "책에만 있는 카테고리");

        BookDataRepository repository = new BookDataRepository(jdbcTemplate);

        assertThat(repository.findAllBookTypes()).containsExactly("저장된 카테고리");
    }

    @Test
    void insertAndUpdateBook_saveNewCategoryValues() {
        JdbcTemplate jdbcTemplate = new JdbcTemplate(new SingleConnectionDataSource("jdbc:sqlite::memory:", true));
        createSchema(jdbcTemplate);
        BookDataRepository repository = new BookDataRepository(jdbcTemplate);

        int bookId = repository.insertBook("책", "저자", "설명", "cover", "만화", "12");
        repository.updateBook(bookId, "책", "저자", "설명", "cover", "소설", "12");

        assertThat(repository.findAllBookTypes()).contains("만화", "소설");
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM books WHERE id = ?", Integer.class, bookId)).isZero();

        repository.updateBook(bookId, "책", "저자", "설명", "/covers/book.jpg", "소설", "12");
        assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM books WHERE id = ?", Integer.class, bookId)).isOne();
    }

    @Test
    void bookListUsesActualVolumeCountInsteadOfStoredTotalVolume() {
        JdbcTemplate jdbcTemplate = new JdbcTemplate(new SingleConnectionDataSource("jdbc:sqlite::memory:", true));
        createSchema(jdbcTemplate);
        BookDataRepository repository = new BookDataRepository(jdbcTemplate);

        int bookId = repository.insertBook("시리즈", "저자", "설명", "cover", "만화", "99");
        jdbcTemplate.update("INSERT INTO book_volumes (book, name, volume) VALUES (?, ?, ?)", bookId, "시리즈 1권", 1);
        jdbcTemplate.update("INSERT INTO book_volumes (book, name, volume) VALUES (?, ?, ?)", bookId, "시리즈 2권", 2);

        assertThat(repository.findAllBooksOrderByCreatedDesc(10, 0))
                .singleElement()
                .extracting(book -> book.totalvolume())
                .isEqualTo("2");
    }

    @Test
    void pendingCoverGeneration_excludesBooksWithoutAladinIsbnVolumes() {
        JdbcTemplate jdbcTemplate = new JdbcTemplate(new SingleConnectionDataSource("jdbc:sqlite::memory:", true));
        createSchema(jdbcTemplate);
        BookDataRepository repository = new BookDataRepository(jdbcTemplate);
        jdbcTemplate.update("INSERT INTO books (id, owner_id, name, cover_generated) VALUES (?, ?, ?, ?)", 1, 7, "알라딘 책", false);
        jdbcTemplate.update("INSERT INTO books (id, owner_id, name, cover_generated) VALUES (?, ?, ?, ?)", 2, 7, "완전 수동 책", false);
        jdbcTemplate.update("INSERT INTO books (id, owner_id, name, cover_generated) VALUES (?, ?, ?, ?)", 3, 8, "다른 사용자 책", false);
        jdbcTemplate.update("INSERT INTO book_volumes (book, isbn13, name) VALUES (?, ?, ?)", 1, "9781234567890", "알라딘 책 1권");
        jdbcTemplate.update("INSERT INTO book_volumes (book, isbn13, name) VALUES (?, ?, ?)", 2, null, "직접 입력 1권");
        jdbcTemplate.update("INSERT INTO book_volumes (book, isbn13, name) VALUES (?, ?, ?)", 3, "9780000000000", "다른 사용자 책 1권");

        assertThat(repository.findBooksPendingCoverGenerationForOwner(7))
                .extracting(book -> book.id())
                .containsExactly(1);
    }

    private void createSchema(JdbcTemplate jdbcTemplate) {
        jdbcTemplate.execute("""
                CREATE TABLE books (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT,
                    author TEXT,
                    description TEXT,
                    totalvolume TEXT,
                    type TEXT,
                    cover TEXT,
                    owner_id INTEGER,
                    cover_generated INTEGER NOT NULL DEFAULT 0,
                    createddate TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbcTemplate.execute("""
                CREATE TABLE book_volumes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book INTEGER,
                    isbn13 TEXT,
                    name TEXT,
                    volume INTEGER,
                    cover_generated INTEGER NOT NULL DEFAULT 0,
                    createddate TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbcTemplate.execute("""
                CREATE TABLE book_categories (
                    name TEXT PRIMARY KEY,
                    createddate TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """);
    }
}
