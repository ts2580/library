package com.example.bookshelf.user.repository;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.nio.file.Path;

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
        useLegacySchema();
        assertThat(repository.countStocksMatching("9780000000001")).isEqualTo(1);
        assertThat(repository.searchStocks("9780000000001", 24, 0)).extracting("id").containsExactly(1);
        assertThat(repository.searchStocks("외전", 24, 0)).extracting("id", "isbn13")
                .containsExactly(org.assertj.core.groups.Tuple.tuple(2, null));
    }

    @Test
    void matchesUnicodeCaseAndCanonicalEquivalentsAcrossAllTextFields() {
        jdbc.update("UPDATE books SET name = 'Étranger' WHERE id = 1");
        jdbc.update("UPDATE branchbook SET name = 'Überlieferung', branch = 'ØST', branchname = 'Σχολείο' WHERE id = 1");
        jdbc.update("UPDATE book_volumes SET name = 'École' WHERE id = 10");
        assertThat(repository.countStocksMatching("étranger")).isEqualTo(2);
        for (String keyword : new String[]{"überlieferung", "école", "E\u0301COLE", "σχολείο", "øst"}) {
            assertThat(repository.countStocksMatching(keyword)).as(keyword).isEqualTo(1);
            assertThat(repository.searchStocks(keyword, 24, 0)).as(keyword).extracting("id").containsExactly(1);
        }
        jdbc.update("UPDATE book_volumes SET name = ? WHERE id = 10", "E\u0301cole");
        assertThat(repository.searchStocks("école", 24, 0)).extracting("id").containsExactly(1);
    }

    @Test
    void unicodeSearchRegistersFunctionOnReplacementPoolConnections(@TempDir Path directory) {
        try (HikariDataSource pool = new HikariDataSource()) {
            pool.setJdbcUrl("jdbc:sqlite:" + directory.resolve("pool.sqlite"));
            pool.setMaximumPoolSize(1);
            new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(pool);
            JdbcTemplate pooledJdbc = new JdbcTemplate(pool);
            pooledJdbc.update("INSERT INTO books (id, name) VALUES (1, 'Étranger')");
            pooledJdbc.update("INSERT INTO book_volumes (id, book, name) VALUES (1, 1, 'École')");
            pooledJdbc.update("INSERT INTO branchbook (id, book, book_volume_id, branch) VALUES (1, 1, 1, 'B1')");
            BranchInventoryRepository pooledRepository = new BranchInventoryRepository(pooledJdbc);
            assertThat(pooledRepository.countStocksMatching("étranger")).isEqualTo(1);
            pool.getHikariPoolMXBean().softEvictConnections();
            assertThat(pooledRepository.searchStocks("école", 24, 0)).extracting("id").containsExactly(1);
            pool.getHikariPoolMXBean().softEvictConnections();
            assertThat(pooledRepository.countStocksMatching("ÉCOLE")).isEqualTo(1);
        }
    }

    @Test
    void legacyJoinResolvesDistinctTitlesWithoutDuplicatingStocksOrPagination() {
        jdbc.update("INSERT INTO book_volumes (id, book, volume, name, isbn13) VALUES (12, 1, 1, '별의 책 특별판', '9780000000004')");
        jdbc.update("INSERT INTO branchbook (id, book, book_volume_id, volume, name, branch) VALUES (4, 1, 12, 1, '별의 책 특별판', 'B3')");
        useLegacySchema();
        assertThat(repository.countStocksMatching("별의 책")).isEqualTo(3);
        assertThat(repository.searchStocks("별의 책", 24, 0)).extracting("id").containsExactlyInAnyOrder(1, 2, 4);
        assertThat(repository.searchStocks("9780000000001", 24, 0)).extracting("id").containsExactly(1);
        assertThat(repository.searchStocks("9780000000004", 24, 0)).extracting("id").containsExactly(4);
        var pagedIds = java.util.stream.IntStream.range(0, 3)
                .flatMap(offset -> repository.searchStocks("별의 책", 1, offset).stream().mapToInt(s -> s.id())).boxed().toList();
        assertThat(pagedIds).containsExactlyInAnyOrder(1, 2, 4);
        assertThat(repository.searchStocks("별의 책", 1, 3)).isEmpty();
        assertThat(repository.findStocksByBranch("B1")).extracting("id").containsExactlyInAnyOrder(1, 3);
    }

    @Test
    void ambiguousLegacyTitleDoesNotInventIsbnOrCoverMatches() {
        jdbc.update("INSERT INTO book_volumes (id, book, volume, name, isbn13, cover) VALUES (12, 1, 1, '별의 책 1권', '9780000000004', '/wrong-cover.jpg')");
        useLegacySchema();
        assertThat(repository.countStocksMatching("9780000000001")).isZero();
        assertThat(repository.searchStocks("9780000000004", 24, 0)).isEmpty();
        assertThat(repository.countStocksMatching("별의 책")).isEqualTo(2);
        assertThat(repository.searchStocks("별의 책 1권", 24, 0)).extracting("id", "isbn13", "cover")
                .containsExactly(org.assertj.core.groups.Tuple.tuple(1, null, null));
        assertThat(repository.findStocksByBranch("B1")).extracting("id").containsExactlyInAnyOrder(1, 3);
    }

    private void useLegacySchema() {
        jdbc.update("UPDATE branchbook SET name = '별의 책 1권' WHERE id = 1");
        jdbc.update("UPDATE branchbook SET name = '별의 책 외전' WHERE id = 2");
        jdbc.update("UPDATE branchbook SET name = '100%_SQL' WHERE id = 3");
        jdbc.execute("ALTER TABLE branchbook RENAME TO branchbook_current");
        jdbc.execute("CREATE TABLE branchbook AS SELECT id, book, volume, name, branch, branchname, grade, price, booklink, purchaseurl FROM branchbook_current");
    }
}
