package com.example.bookshelf.user.repository;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class BookVolumeRepositoryTest {

    @Test
    void amountSummaries_splitPurchasedAndPlannedPrices_excludingNoNeedToBuyFromPlanned() {
        SingleConnectionDataSource dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.execute("CREATE TABLE book_volumes (price TEXT, ispurchased INTEGER, noneedtobuy INTEGER)");
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased, noneedtobuy) VALUES (?, ?, ?)", "10,000", true, false);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased, noneedtobuy) VALUES (?, ?, ?)", "2500", true, false);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased, noneedtobuy) VALUES (?, ?, ?)", "가격없음", true, false);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased, noneedtobuy) VALUES (?, ?, ?)", "4,000", false, false);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased, noneedtobuy) VALUES (?, ?, ?)", "8,000", false, true);
        jdbcTemplate.update("INSERT INTO book_volumes (price, ispurchased, noneedtobuy) VALUES (?, ?, ?)", null, false, false);

        BookVolumeRepository repository = new BookVolumeRepository(jdbcTemplate);

        assertThat(repository.sumPurchasedAmount()).isEqualTo(12_500L);
        assertThat(repository.sumPlannedPurchaseAmount()).isEqualTo(4_000L);
    }

    @Test
    void stockRefreshTargets_excludePurchasedAndNoNeedToBuyVolumes() {
        SingleConnectionDataSource dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.execute("""
                CREATE TABLE book_volumes (
                    id INTEGER PRIMARY KEY,
                    volume INTEGER,
                    book INTEGER,
                    isbn13 TEXT,
                    name TEXT,
                    cover TEXT,
                    price TEXT,
                    description TEXT,
                    ispurchased INTEGER,
                    noneedtobuy INTEGER,
                    createddate TEXT
                )
                """);
        jdbcTemplate.update("INSERT INTO book_volumes (id, volume, book, isbn13, name, ispurchased, noneedtobuy) VALUES (?, ?, ?, ?, ?, ?, ?)", 1, 1, 10, "9781111111111", "조회 대상", false, false);
        jdbcTemplate.update("INSERT INTO book_volumes (id, volume, book, isbn13, name, ispurchased, noneedtobuy) VALUES (?, ?, ?, ?, ?, ?, ?)", 2, 2, 10, "9782222222222", "구매 완료", true, false);
        jdbcTemplate.update("INSERT INTO book_volumes (id, volume, book, isbn13, name, ispurchased, noneedtobuy) VALUES (?, ?, ?, ?, ?, ?, ?)", 3, 3, 10, "9783333333333", "살 필요 없음", false, true);

        BookVolumeRepository repository = new BookVolumeRepository(jdbcTemplate);

        assertThat(repository.countUnpurchasedVolumes()).isEqualTo(1);
        assertThat(repository.findUnpurchasedVolumesAfterId(0, 100))
                .extracting(volume -> volume.isbn13())
                .containsExactly("9781111111111");
    }

    @Test
    void updateVolume_sideStoryStoresNullSequenceAndSortsAfterNumberedVolumes() {
        SingleConnectionDataSource dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.execute("""
                CREATE TABLE book_volumes (
                    id INTEGER PRIMARY KEY,
                    volume INTEGER,
                    book INTEGER,
                    isbn13 TEXT,
                    name TEXT,
                    cover TEXT,
                    price TEXT,
                    description TEXT,
                    ispurchased INTEGER,
                    noneedtobuy INTEGER,
                    createddate TEXT
                )
                """);
        jdbcTemplate.update("INSERT INTO book_volumes (id, volume, book, name, ispurchased, noneedtobuy) VALUES (?, ?, ?, ?, ?, ?)", 1, 1, 10, "외전", false, false);
        jdbcTemplate.update("INSERT INTO book_volumes (id, volume, book, name, ispurchased, noneedtobuy) VALUES (?, ?, ?, ?, ?, ?)", 2, 2, 10, "2권", false, false);
        BookVolumeRepository repository = new BookVolumeRepository(jdbcTemplate);

        repository.updateVolume(10, 1, null, "외전", null, null, null, false, false, null);
        repository.insertVolume(10, null, "9783333333333", "새 외전", null, null, null);

        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE volume IS NULL", Integer.class)).isEqualTo(2);
        assertThat(repository.findVolumesByBookId(10))
                .extracting(volume -> volume.name())
                .containsExactly("2권", "외전", "새 외전");
        assertThat(repository.findVolumesByBookId(10).get(1).sideStory()).isTrue();
        assertThat(repository.findVolumesByBookId(10).get(1).nullableSeq()).isNull();
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
