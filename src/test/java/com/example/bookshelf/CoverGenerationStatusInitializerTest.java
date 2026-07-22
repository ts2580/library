package com.example.bookshelf;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class CoverGenerationStatusInitializerTest {

    @Test
    void run_addsPendingCoverColumnsToExistingDatabase() throws Exception {
        try (SingleConnectionDataSource dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true)) {
            JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
            jdbcTemplate.execute("CREATE TABLE books (id INTEGER PRIMARY KEY, owner_id INTEGER)");
            jdbcTemplate.execute("CREATE TABLE book_volumes (id INTEGER PRIMARY KEY, book INTEGER)");
            jdbcTemplate.update("INSERT INTO books (id, owner_id) VALUES (1, 7)");
            jdbcTemplate.update("INSERT INTO book_volumes (id, book) VALUES (2, 1)");

            new CoverGenerationStatusInitializer(jdbcTemplate).run();

            assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM books WHERE id = 1", Integer.class)).isZero();
            assertThat(jdbcTemplate.queryForObject("SELECT cover_generated FROM book_volumes WHERE id = 2", Integer.class)).isZero();
        }
    }
}
