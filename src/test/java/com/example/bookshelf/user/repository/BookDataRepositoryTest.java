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
                    createddate TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """);
        jdbcTemplate.execute("""
                CREATE TABLE book_volumes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book INTEGER,
                    name TEXT,
                    volume INTEGER,
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
