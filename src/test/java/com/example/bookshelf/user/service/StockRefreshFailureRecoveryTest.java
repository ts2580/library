package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.integration.aladin.AladinRateLimitException;
import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import com.example.bookshelf.user.repository.StockRefreshJobRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.List;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class StockRefreshFailureRecoveryTest {
    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbc;
    private BookVolumeRepository volumes;
    private BranchInventoryRepository stocks;
    private AladinUsedStockService aladin;

    @BeforeEach
    void setUp() {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);
        jdbc = new JdbcTemplate(dataSource);
        volumes = new BookVolumeRepository(jdbc);
        stocks = new BranchInventoryRepository(jdbc);
        aladin = mock(AladinUsedStockService.class);
        when(aladin.isApiConfigured()).thenReturn(true);
        jdbc.update("INSERT INTO books (id, name) VALUES (1, '재현용 책')");
        jdbc.update("INSERT INTO book_volumes (id, book, volume, name, isbn13) VALUES (1, 1, 1, '1권', '9780000000001'), (2, 1, 2, '2권', '9780000000002')");
        jdbc.update("INSERT INTO branchbook (book, book_volume_id, volume, name, branch, branchname, price) VALUES (1, 1, 1, '1권', 'OLD', '이전 지점', '1234')");
        stocks.rebuildBranchInventorySummary();
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void persistentRateLimitKeepsPartialStocksAndSummaryConsistent() {
        firstLookupSucceeds();
        when(aladin.lookupUsedStocksByIsbn13("9780000000002"))
                .thenThrow(new AladinRateLimitException("HTTP 429", new RuntimeException("rate limited")));
        StockRefreshService service = new StockRefreshService(volumes, stocks, aladin, Runnable::run);

        service.startStockRefreshJob();

        assertThat(service.getStockRefreshProgress().failed()).isTrue();
        assertThat(service.getStockRefreshProgress().message()).contains("429");
        assertPartialInventoryAndSummary();
    }

    @Test
    void failedBatchReadAlsoRebuildsSummaryForSuccessfulLookups() {
        firstLookupSucceeds();
        BookVolumeRepository failingVolumes = spy(volumes);
        doReturn(volumes.findUnpurchasedVolumesAfterId(0, 1)).when(failingVolumes).findUnpurchasedVolumesAfterId(0, 100);
        doThrow(new IllegalStateException("batch read failed")).when(failingVolumes).findUnpurchasedVolumesAfterId(1, 100);
        StockRefreshService service = new StockRefreshService(failingVolumes, stocks, aladin, Runnable::run);

        service.startStockRefreshJob();

        assertThat(service.getStockRefreshProgress().failed()).isTrue();
        assertThat(service.getStockRefreshProgress().message()).contains("batch read failed");
        assertPartialInventoryAndSummary();
    }

    @Test
    void rejectedTaskPreservesInventoryAndAllowsAnotherStart() {
        AtomicBoolean reject = new AtomicBoolean(true);
        AtomicReference<Runnable> queued = new AtomicReference<>();
        StockRefreshService service = new StockRefreshService(volumes, stocks, aladin, task -> {
            if (reject.get()) throw new RejectedExecutionException("executor stopped");
            queued.set(task);
        });

        assertThatThrownBy(service::startStockRefreshJob).isInstanceOf(RejectedExecutionException.class);

        assertOldInventoryPreserved();
        assertThat(service.getStockRefreshProgress().running()).isFalse();
        assertThat(service.getStockRefreshProgress().failed()).isTrue();
        verify(aladin, never()).lookupUsedStocksByIsbn13(any());
        reject.set(false);
        assertThat(service.startStockRefreshJob().started()).isTrue();
        assertThat(queued.get()).isNotNull();
        assertOldInventoryPreserved();
    }

    @Test
    void progressPersistenceFailurePreservesInventoryAndAllowsAnotherStart() {
        StockRefreshJobRepository jobs = mock(StockRefreshJobRepository.class);
        doThrow(new IllegalStateException("progress save failed")).doNothing().when(jobs).save(any());
        AtomicReference<Runnable> queued = new AtomicReference<>();
        StockRefreshService service = new StockRefreshService(volumes, stocks, aladin, queued::set, jobs);

        assertThatThrownBy(service::startStockRefreshJob).isInstanceOf(IllegalStateException.class);

        assertOldInventoryPreserved();
        assertThat(queued.get()).isNull();
        assertThat(service.getStockRefreshProgress().running()).isFalse();
        assertThat(service.getStockRefreshProgress().failed()).isTrue();
        assertThat(service.startStockRefreshJob().started()).isTrue();
        assertThat(queued.get()).isNotNull();
        assertOldInventoryPreserved();
    }

    @Test
    void persistentProgressStorageFailureDoesNotMaskStartupErrorOrKeepLock() {
        StockRefreshJobRepository jobs = mock(StockRefreshJobRepository.class);
        IllegalStateException failure = new IllegalStateException("progress storage unavailable");
        doThrow(failure).when(jobs).save(any());
        AtomicReference<Runnable> queued = new AtomicReference<>();
        StockRefreshService service = new StockRefreshService(volumes, stocks, aladin, queued::set, jobs);

        assertThatThrownBy(service::startStockRefreshJob).isSameAs(failure);
        assertThatThrownBy(service::startStockRefreshJob).isSameAs(failure);

        assertOldInventoryPreserved();
        assertThat(queued.get()).isNull();
        assertThat(service.getStockRefreshProgress().failed()).isTrue();
        assertThat(service.getStockRefreshProgress().running()).isFalse();
    }

    @Test
    void summaryRecoveryFailureKeepsOriginalAbortVisible() {
        BranchInventoryRepository failingStocks = spy(stocks);
        doThrow(new IllegalStateException("summary storage unavailable")).when(failingStocks).rebuildBranchInventorySummary();
        when(aladin.lookupUsedStocksByIsbn13("9780000000001"))
                .thenThrow(new AladinRateLimitException("HTTP 429", new RuntimeException("rate limited")));
        StockRefreshService service = new StockRefreshService(volumes, failingStocks, aladin, Runnable::run);

        service.startStockRefreshJob();

        assertThat(service.getStockRefreshProgress().failed()).isTrue();
        assertThat(service.getStockRefreshProgress().running()).isFalse();
        assertThat(service.getStockRefreshProgress().message()).contains("429", "재고 집계 갱신에도 실패");
    }

    @Test
    void zeroTargetJobAlsoPreservesInventoryIfRejected() {
        jdbc.update("UPDATE book_volumes SET ispurchased = TRUE");
        StockRefreshService service = new StockRefreshService(volumes, stocks, aladin,
                task -> { throw new RejectedExecutionException("executor stopped"); });

        assertThatThrownBy(service::startStockRefreshJob).isInstanceOf(RejectedExecutionException.class);

        assertOldInventoryPreserved();
        assertThat(service.getStockRefreshProgress().failed()).isTrue();
    }

    @Test
    void acceptedZeroTargetJobClearsInventoryOnlyWhenItRuns() {
        jdbc.update("UPDATE book_volumes SET ispurchased = TRUE WHERE id = 1");
        jdbc.update("UPDATE book_volumes SET noneedtobuy = TRUE WHERE id = 2");
        AtomicReference<Runnable> queued = new AtomicReference<>();
        StockRefreshService service = new StockRefreshService(volumes, stocks, aladin, queued::set);

        var result = service.startStockRefreshJob();

        assertThat(result.started()).isTrue();
        assertThat(result.progress().running()).isTrue();
        assertOldInventoryPreserved();
        queued.get().run();
        assertThat(service.getStockRefreshProgress().completed()).isTrue();
        assertThat(service.getStockRefreshProgress().message()).contains("이전 지점 재고를 삭제");
        assertThat(stocks.countStocksMatching("재현용 책")).isZero();
        assertThat(stocks.findBranchInventorySummaries()).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM book_volumes", Integer.class)).isEqualTo(2);
        verify(aladin, never()).lookupUsedStocksByIsbn13(any());
    }

    private void firstLookupSucceeds() {
        when(aladin.lookupUsedStocksByIsbn13("9780000000001")).thenReturn(
                AladinUsedStockService.StockLookupResult.success(List.of(
                        new AladinBranchStock("B1", "강남점", "A", "new-link", null, "9000", 1, "1권"))));
    }

    private void assertPartialInventoryAndSummary() {
        assertThat(stocks.countStocksMatching("재현용 책")).isEqualTo(1);
        assertThat(stocks.findStocksByBranch("B1")).hasSize(1);
        assertThat(stocks.findStocksByBranch("OLD")).isEmpty();
        assertThat(stocks.findBranchInventorySummaries()).extracting("branch", "stockCount", "totalAmount")
                .containsExactly(org.assertj.core.groups.Tuple.tuple("B1", 1, 9000L));
    }

    private void assertOldInventoryPreserved() {
        assertThat(stocks.findStocksByBranch("OLD")).hasSize(1);
        assertThat(stocks.findBranchInventorySummaries()).extracting("branch", "stockCount", "totalAmount")
                .containsExactly(org.assertj.core.groups.Tuple.tuple("OLD", 1, 1234L));
    }
}
