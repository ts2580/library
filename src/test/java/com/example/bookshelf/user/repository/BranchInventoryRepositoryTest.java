package com.example.bookshelf.user.repository;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import static org.assertj.core.api.Assertions.assertThat;

class BranchInventoryRepositoryTest {
    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbc;
    private BranchInventoryRepository repository;

    @BeforeEach
    void setUp() {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);
        jdbc = new JdbcTemplate(dataSource);
        repository = new BranchInventoryRepository(jdbc);
        jdbc.update("INSERT INTO books (id, name) VALUES (1, '별의 책'), (2, 'SQL Guide')");
        jdbc.update("INSERT INTO book_volumes (id, book, volume, name, isbn13) VALUES (10, 1, 1, '별의 책 1권', '9780000000001'), (11, 1, NULL, '별의 책 외전', '9780000000002'), (20, 2, 1, '100%_SQL', '9780000000003')");
        jdbc.update("INSERT INTO branchbook (id, book, book_volume_id, volume, name, branch, branchname, grade, price) VALUES (1, 1, 10, 1, '별의 책', 'B1', '강남점', 'A', '9,000'), (2, 1, 11, 1, '별의 책', 'B2', '종로점', 'B', '7,000'), (3, 2, 20, 1, 'SQL Guide', 'B1', '강남점', 'A', NULL)");
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void searchesTitlesIsbnAndBranchesUsingStableVolumeReference() {
        assertThat(repository.countStocksMatching("별의 책")).isEqualTo(2);
        assertThat(repository.searchStocks("  외전  ", 24, 0))
                .extracting("id", "volumeTitle", "isbn13")
                .containsExactly(org.assertj.core.groups.Tuple.tuple(2, "별의 책 외전", "9780000000002"));
        assertThat(repository.searchStocks("9780000000001", 24, 0)).extracting("id").containsExactly(1);
        assertThat(repository.countStocksMatching("강남")).isEqualTo(2);
        assertThat(repository.countStocksMatching("b2")).isEqualTo(1);
        assertThat(repository.countStocksMatching("sql guide")).isEqualTo(1);
        assertThat(repository.findStocksByBranch("B2")).extracting("isbn13").containsExactly("9780000000002");
    }

    @Test
    void treatsSqlSpecialCharactersLiterallyAndHandlesEmptyOrMissingMatches() {
        assertThat(repository.countStocksMatching("%_")).isEqualTo(1);
        assertThat(repository.searchStocks("%_", 24, 0)).extracting("id").containsExactly(3);
        assertThat(repository.countStocksMatching("' OR 1=1 --")).isZero();
        assertThat(repository.countStocksMatching("없는 책")).isZero();
        assertThat(repository.countStocksMatching("  ")).isZero();
        assertThat(repository.searchStocks(null, 24, 0)).isEmpty();
    }

    @Test
    void paginatesMatchingStockRowsWithoutDuplicates() {
        assertThat(repository.searchStocks("별의 책", 1, 0)).extracting("id").containsExactly(1);
        assertThat(repository.searchStocks("별의 책", 1, 1)).extracting("id").containsExactly(2);
        assertThat(repository.searchStocks("별의 책", 1, 2)).isEmpty();
    }

    @Test
    void searchesLegacySchemaWithoutVolumeReferenceColumn() {
        jdbc.execute("ALTER TABLE branchbook RENAME TO branchbook_current");
        jdbc.execute("CREATE TABLE branchbook AS SELECT id, book, volume, name, branch, branchname, grade, price, booklink, purchaseurl FROM branchbook_current");
        assertThat(repository.countStocksMatching("9780000000001")).isEqualTo(2);
        assertThat(repository.searchStocks("9780000000001", 24, 0)).extracting("id").containsExactly(1, 2);
    }
}
