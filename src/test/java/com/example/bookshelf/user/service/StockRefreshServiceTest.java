package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.integration.aladin.AladinRateLimitException;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import com.example.bookshelf.user.repository.StockRefreshJobRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.inOrder;

@ExtendWith(MockitoExtension.class)
class StockRefreshServiceTest {

    @Mock private BookVolumeRepository bookVolumeRepository;
    @Mock private BranchInventoryRepository branchInventoryRepository;
    @Mock private AladinUsedStockService aladinUsedStockService;
    @Mock private StockRefreshJobRepository stockRefreshJobRepository;

    private StockRefreshService stockRefreshService;

    @BeforeEach
    void setUp() {
        // Use a direct executor for the main job to make tests synchronous
        Executor directExecutor = Runnable::run;
        stockRefreshService = new StockRefreshService(
                bookVolumeRepository,
                branchInventoryRepository,
                aladinUsedStockService,
                directExecutor,
                null
        );
    }

    @Test
    void startStockRefreshJob_rebuildsSummaryAfterProcessing() {
        when(aladinUsedStockService.isApiConfigured()).thenReturn(true);
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(1);
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(0, 100)).thenReturn(List.of(
                new BookVolume(1, 1, 10, "9781234567890", "책1", null, null, null, false, false, "1")
        ));
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(1, 100)).thenReturn(List.of());
        when(aladinUsedStockService.lookupUsedStocksByIsbn13("9781234567890")).thenReturn(
                AladinUsedStockService.StockLookupResult.success(List.of(
                        new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "책1")
                )));

        var result = stockRefreshService.startStockRefreshJob();
        assertThat(result.started()).isTrue();
        // No sleep needed because executors are synchronous

        verify(branchInventoryRepository).replaceBranchBooks(1, 10, "책1", 1, List.of(new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "책1")));
        verify(branchInventoryRepository).rebuildBranchInventorySummary();
    }

    @Test
    void startStockRefreshJob_deletesPreviousStocks_whenLookupSucceedsWithEmptyResult() {
        when(aladinUsedStockService.isApiConfigured()).thenReturn(true);
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(1);
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(0, 100)).thenReturn(List.of(
                new BookVolume(1, 1, 10, "9781234567890", "책1", null, null, null, false, false, "1")
        ));
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(1, 100)).thenReturn(List.of());
        when(aladinUsedStockService.lookupUsedStocksByIsbn13("9781234567890")).thenReturn(
                AladinUsedStockService.StockLookupResult.success(List.of()));

        var result = stockRefreshService.startStockRefreshJob();

        assertThat(result.started()).isTrue();
        verify(branchInventoryRepository).deleteBranchBooksByBookVolumeId(1, 10, 1);
        verify(branchInventoryRepository, never()).replaceBranchBooks(org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyList());
        verify(branchInventoryRepository).rebuildBranchInventorySummary();
    }

    @Test
    void startStockRefreshJob_clearsPreviousStocks_whenLookupFails() {
        when(aladinUsedStockService.isApiConfigured()).thenReturn(true);
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(1);
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(0, 100)).thenReturn(List.of(
                new BookVolume(1, 1, 10, "9781234567890", "책1", null, null, null, false, false, "1")
        ));
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(1, 100)).thenReturn(List.of());
        when(aladinUsedStockService.lookupUsedStocksByIsbn13("9781234567890")).thenReturn(
                AladinUsedStockService.StockLookupResult.failure("network down"));

        stockRefreshService.startStockRefreshJob();

        var order = inOrder(branchInventoryRepository, aladinUsedStockService);
        order.verify(branchInventoryRepository).deleteAllBranchInventoryData();
        order.verify(aladinUsedStockService).lookupUsedStocksByIsbn13("9781234567890");
        verify(branchInventoryRepository, never()).deleteBranchBooksByBookVolumeId(1, 10, 1);
        verify(branchInventoryRepository, never()).replaceBranchBooks(org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyList());
        verify(branchInventoryRepository).rebuildBranchInventorySummary();
    }

    @Test
    void startStockRefreshJob_stopsRemainingTargets_whenRateLimitPersists() {
        when(aladinUsedStockService.isApiConfigured()).thenReturn(true);
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(2);
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(0, 100)).thenReturn(List.of(
                new BookVolume(1, 1, 10, "9781234567890", "책1", null, null, null, false, false, "1"),
                new BookVolume(2, 2, 20, "9781234567891", "책2", null, null, null, false, false, "1")
        ));
        when(aladinUsedStockService.lookupUsedStocksByIsbn13("9781234567890"))
                .thenThrow(new AladinRateLimitException("HTTP 429", new RuntimeException("rate limited")));

        stockRefreshService.startStockRefreshJob();

        assertThat(stockRefreshService.getStockRefreshProgress().failed()).isTrue();
        assertThat(stockRefreshService.getStockRefreshProgress().message()).contains("429");
        verify(aladinUsedStockService, never()).lookupUsedStocksByIsbn13("9781234567891");
        verify(branchInventoryRepository, never()).deleteBranchBooksByBookVolumeId(
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyInt()
        );
        verify(branchInventoryRepository, never()).rebuildBranchInventorySummary();
    }

    @Test
    void startStockRefreshJob_returnsFailedProgress_whenAladinKeyIsMissing() {
        when(aladinUsedStockService.isApiConfigured()).thenReturn(false);

        var result = stockRefreshService.startStockRefreshJob();

        assertThat(result.started()).isFalse();
        assertThat(result.progress().failed()).isTrue();
        assertThat(result.message()).contains("TTB 키");
        verify(bookVolumeRepository, never()).countUnpurchasedVolumes();
        verify(branchInventoryRepository, never()).deleteAllBranchInventoryData();
        verify(branchInventoryRepository, never()).rebuildBranchInventorySummary();
    }

    @Test
    void startStockRefreshJob_allowsOnlyOneQueuedJob() {
        AtomicReference<Runnable> queuedJob = new AtomicReference<>();
        StockRefreshService service = new StockRefreshService(
                bookVolumeRepository,
                branchInventoryRepository,
                aladinUsedStockService,
                queuedJob::set,
                null
        );
        when(aladinUsedStockService.isApiConfigured()).thenReturn(true);
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(1);
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(0, 100)).thenReturn(List.of());

        var first = service.startStockRefreshJob();
        var second = service.startStockRefreshJob();

        assertThat(first.started()).isTrue();
        assertThat(second.started()).isFalse();
        assertThat(second.message()).contains("이미");
        verify(bookVolumeRepository, times(1)).countUnpurchasedVolumes();
        verify(branchInventoryRepository, times(1)).deleteAllBranchInventoryData();

        queuedJob.get().run();
        assertThat(service.getStockRefreshProgress().completed()).isTrue();
    }

    @Test
    void startStockRefreshJob_clearsPreviousInventoryEvenWhenEveryVolumeIsPurchasedOrNotNeeded() {
        when(aladinUsedStockService.isApiConfigured()).thenReturn(true);
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(0);

        var result = stockRefreshService.startStockRefreshJob();

        assertThat(result.started()).isFalse();
        assertThat(result.progress().completed()).isTrue();
        assertThat(result.message()).contains("이전 지점 재고를 삭제", "구매 필요 항목이 없습니다");
        verify(branchInventoryRepository).deleteAllBranchInventoryData();
        verify(bookVolumeRepository, never()).findUnpurchasedVolumesAfterId(org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void startStockRefreshJob_removesStoredPurchasedStocksAndSummariesBeforeQueuedLookups() {
        SingleConnectionDataSource dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        try {
            new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);
            JdbcTemplate jdbc = new JdbcTemplate(dataSource);
            jdbc.update("INSERT INTO books (id, name) VALUES (1, '죄의 끝')");
            jdbc.update("INSERT INTO book_volumes (id, book, volume, name, isbn13, ispurchased, noneedtobuy) VALUES (1, 1, 1, '죄의 끝', '9780000000001', TRUE, FALSE), (2, 1, 2, '다음 권', '9780000000002', FALSE, FALSE), (3, 1, 3, '불필요한 권', '9780000000003', FALSE, TRUE)");
            jdbc.update("INSERT INTO branchbook (book, book_volume_id, branch, branchname, price) VALUES (1, 1, 'B1', '강남점', '9000'), (1, 2, 'B1', '강남점', '7000'), (1, 3, 'B2', '종로점', '6000')");
            BranchInventoryRepository stocks = new BranchInventoryRepository(jdbc);
            stocks.rebuildBranchInventorySummary();
            assertThat(stocks.countStocksMatching("죄의 끝")).isEqualTo(3);
            assertThat(stocks.countBranchInventorySummaries()).isEqualTo(2);
            AtomicReference<Runnable> queued = new AtomicReference<>();
            StockRefreshService service = new StockRefreshService(new BookVolumeRepository(jdbc), stocks,
                    aladinUsedStockService, queued::set, null);
            when(aladinUsedStockService.isApiConfigured()).thenReturn(true);
            when(aladinUsedStockService.lookupUsedStocksByIsbn13("9780000000002"))
                    .thenReturn(AladinUsedStockService.StockLookupResult.failure("network down"));

            var result = service.startStockRefreshJob();

            assertThat(result.started()).isTrue();
            assertThat(result.progress().total()).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM branchbook", Integer.class)).isZero();
            assertThat(stocks.countBranchInventorySummaries()).isZero();
            assertThat(stocks.searchStocks("죄의 끝", 24, 0)).isEmpty();
            queued.get().run();
            assertThat(service.getStockRefreshProgress().fail()).isEqualTo(1);
            assertThat(stocks.findStocksByBranch("B1")).isEmpty();
            assertThat(stocks.findBranchInventorySummaries()).isEmpty();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM book_volumes", Integer.class)).isEqualTo(3);
            verify(aladinUsedStockService, never()).lookupUsedStocksByIsbn13("9780000000001");
            verify(aladinUsedStockService, never()).lookupUsedStocksByIsbn13("9780000000003");
        } finally {
            dataSource.destroy();
        }
    }

    @Test
    void restorePersistedProgress_marksInterruptedJobAsFailed() {
        Executor directExecutor = Runnable::run;
        StockRefreshService service = new StockRefreshService(
                bookVolumeRepository,
                branchInventoryRepository,
                aladinUsedStockService,
                directExecutor,
                stockRefreshJobRepository
        );
        when(stockRefreshJobRepository.find()).thenReturn(StockRefreshService.StockRefreshProgress.running(20));

        service.restorePersistedProgress();

        assertThat(service.getStockRefreshProgress().failed()).isTrue();
        assertThat(service.getStockRefreshProgress().message()).contains("재기동");
        verify(stockRefreshJobRepository).save(org.mockito.ArgumentMatchers.argThat(StockRefreshService.StockRefreshProgress::failed));
    }
}
