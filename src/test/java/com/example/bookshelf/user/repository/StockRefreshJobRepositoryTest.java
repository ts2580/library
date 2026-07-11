package com.example.bookshelf.user.repository;

import com.example.bookshelf.user.service.StockRefreshService.StockRefreshProgress;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class StockRefreshJobRepositoryTest {

    private SingleConnectionDataSource dataSource;
    private StockRefreshJobRepository repository;

    @BeforeEach
    void setUp() {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        repository = new StockRefreshJobRepository(new JdbcTemplate(dataSource));
        repository.initialize();
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void savesAndRestoresLastProgress() {
        StockRefreshProgress progress = StockRefreshProgress.completed(20, 20, 15, 3, 2, "완료");

        repository.save(progress);

        assertThat(repository.find()).isEqualTo(progress);
    }
}
