package com.example.bookshelf.user.repository;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class BookVolumeRepositoryTest {

    @Test
    void amountSummaries_splitPurchasedAndPlannedPrices() {
        SingleConnectionDataSource dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.execute("CREATE TABLE book_volumes (price TEXT, ispurchased INTEGER)");
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased) VALUES (?, ?)", "10,000", true);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased) VALUES (?, ?)", "2500", true);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased) VALUES (?, ?)", "가격없음", true);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased) VALUES (?, ?)", "4,000", false);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased) VALUES (?, ?)", null, false);

        BookVolumeRepository repository = new BookVolumeRepository(jdbcTemplate);

        assertThat(repository.sumPurchasedAmount()).isEqualTo(12_500L);
        assertThat(repository.sumPlannedPurchaseAmount()).isEqualTo(4_000L);
    }

    @Test
    void findCategorySummaries_countsVolumesAndAmountsByBookType() {
        SingleConnectionDataSource dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.execute("CREATE TABLE books (id INTEGER PRIMARY KEY, type TEXT)");
        jdbcTemplate.execute("CREATE TABLE book_volumes (book INTEGER, price TEXT)");
        jdbcTemplate.update("INSERT INTO books (id, type) VALUES (?, ?)", 1, "만화");
        jdbcTemplate.update("INSERT INTO books (id, type) VALUES (?, ?)", 2, "소설");
        jdbcTemplate.update("INSERT INTO books (id, type) VALUES (?, ?)", 3, "");
        jdbcTemplate.update("INSERT INTO book_volumes (book, price) VALUES (?, ?)", 1, "10,000");
        jdbcTemplate.update("INSERT INTO book_volumes (book, price) VALUES (?, ?)", 1, "2,500");
        jdbcTemplate.update("INSERT INTO book_volumes (book, price) VALUES (?, ?)", 2, "7,000");
        jdbcTemplate.update("INSERT INTO book_volumes (book, price) VALUES (?, ?)", 3, "가격없음");

        BookVolumeRepository repository = new BookVolumeRepository(jdbcTemplate);

        assertThat(repository.findCategorySummaries()).containsExactly(
                new BookVolumeRepository.CategorySummary("만화", 2, 12_500L),
                new BookVolumeRepository.CategorySummary("소설", 1, 7_000L),
                new BookVolumeRepository.CategorySummary("미분류", 1, 0L)
        );
    }
}
