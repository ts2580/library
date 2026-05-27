package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class StockRefreshService {

    private static final Logger log = LoggerFactory.getLogger(StockRefreshService.class);
    private static final int STOCK_REFRESH_BATCH_SIZE = 100;

    private final BookVolumeRepository bookVolumeRepository;
    private final BranchInventoryRepository branchInventoryRepository;
    private final AladinUsedStockService aladinUsedStockService;
    private final Executor aladinFetchExecutor;
    private final Executor refreshExecutor;

    private final AtomicBoolean refreshRunning = new AtomicBoolean(false);
    private final AtomicReference<StockRefreshProgress> refreshProgress = new AtomicReference<>(StockRefreshProgress.idle());

    public StockRefreshService(BookVolumeRepository bookVolumeRepository,
                               BranchInventoryRepository branchInventoryRepository,
                               AladinUsedStockService aladinUsedStockService,
                               @Qualifier("aladinFetchExecutor") Executor aladinFetchExecutor) {
        this.bookVolumeRepository = bookVolumeRepository;
        this.branchInventoryRepository = branchInventoryRepository;
        this.aladinUsedStockService = aladinUsedStockService;
        this.aladinFetchExecutor = aladinFetchExecutor;
        // Internal job executor (single thread to manage the job flow)
        this.refreshExecutor = r -> {
            Thread thread = new Thread(r, "bookshelf-stock-refresh");
            thread.setDaemon(true);
            thread.start();
        };
    }

    public JobStartResult startStockRefreshJob() {
        if (refreshRunning.get()) {
            return new JobStartResult(false, refreshProgress.get(), "이미 일괄 갱신이 진행 중입니다.");
        }

        int total = bookVolumeRepository.countUnpurchasedVolumes();
        if (total == 0) {
            StockRefreshProgress idle = StockRefreshProgress.completed(0, 0, 0, 0, "조회할 미구매 항목이 없습니다. (ispurchased = false)");
            refreshProgress.set(idle);
            return new JobStartResult(false, idle, idle.message());
        }

        refreshProgress.set(StockRefreshProgress.running(total));
        refreshRunning.set(true);
        refreshExecutor.execute(() -> runStockRefreshJob(total));
        return new JobStartResult(true, refreshProgress.get(), "미구매권 중고 재고 일괄 갱신을 시작했습니다.");
    }

    public StockRefreshProgress getStockRefreshProgress() {
        return refreshProgress.get();
    }

    public void deleteAllBranchInventory() {
        branchInventoryRepository.deleteAllBranchInventoryData();
        refreshProgress.set(StockRefreshProgress.idle());
    }

    private void runStockRefreshJob(int total) {
        RefreshCounters counters = new RefreshCounters();
        int lastSeenId = 0;
        try {
            while (true) {
                List<BookVolume> volumes = fetchRefreshBatch(lastSeenId);
                if (volumes.isEmpty()) break;
                lastSeenId = processRefreshBatch(volumes, total, counters);
            }
            rebuildSummaryAfterRefresh(total, counters);
        } catch (Exception e) {
            log.error("Stock refresh job failed", e);
            refreshProgress.set(StockRefreshProgress.failed(total, counters.processed.get(), counters.success.get(), counters.empty.get(), counters.fail.get(), "일괄 갱신 중 오류가 발생했습니다: " + e.getMessage()));
        } finally {
            refreshRunning.set(false);
        }
    }

    private List<BookVolume> fetchRefreshBatch(int lastSeenId) {
        return bookVolumeRepository.findUnpurchasedVolumesAfterId(lastSeenId, STOCK_REFRESH_BATCH_SIZE);
    }

    private int processRefreshBatch(List<BookVolume> volumes, int total, RefreshCounters counters) {
        List<CompletableFuture<Void>> futures = volumes.stream()
                .map(volume -> CompletableFuture.runAsync(() -> processSingleRefreshTarget(volume, total, counters), aladinFetchExecutor))
                .toList();

        // Wait for all tasks in the current batch to complete
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

        // Return the ID of the last processed volume in this batch for the next fetch
        return volumes.get(volumes.size() - 1).id();
    }

    private void processSingleRefreshTarget(BookVolume volume, int total, RefreshCounters counters) {
        String isbn13 = volume.isbn13();
        if (isbn13 == null || isbn13.isEmpty()) {
            counters.fail.incrementAndGet();
            counters.processed.incrementAndGet();
            publishRefreshProgress(total, counters, "ISBN13이 없는 항목을 건너뛰는 중입니다.");
            return;
        }

        try {
            List<AladinBranchStock> stocks = aladinUsedStockService.findUsedStocksByIsbn13(isbn13);
            if (stocks.isEmpty()) {
                counters.empty.incrementAndGet();
            } else {
                branchInventoryRepository.deleteBranchBooksByBookAndVolume(volume.bookId(), volume.seq());
                branchInventoryRepository.insertBranchBooks(volume.bookId(), safeTitle(volume), volume.seq(), stocks);
                counters.success.incrementAndGet();
            }
        } catch (RuntimeException e) {
            counters.fail.incrementAndGet();
            log.warn("Failed to refresh stocks for bookId={}, seq={}, isbn13={}", volume.bookId(), volume.seq(), isbn13, e);
        }

        counters.processed.incrementAndGet();
        publishRefreshProgress(total, counters, "미구매권 중고 재고를 갱신 중입니다. (" + counters.processed.get() + "/" + total + ")");
    }

    private void rebuildSummaryAfterRefresh(int total, RefreshCounters counters) {
        publishRefreshProgress(total, counters, "차트용 집계 테이블을 갱신하는 중입니다.");
        branchInventoryRepository.rebuildBranchInventorySummary();
        String message = "재고 일괄 조회 완료: 총 " + total + "권 중 " + counters.success.get() + "권 성공, " + counters.empty.get() + "권 재고없음, " + counters.fail.get() + "권 실패";
        refreshProgress.set(StockRefreshProgress.completed(total, counters.processed.get(), counters.success.get(), counters.empty.get(), counters.fail.get(), message));
    }

    private void publishRefreshProgress(int total, RefreshCounters counters, String message) {
        refreshProgress.set(new StockRefreshProgress(true, false, false, total, counters.processed.get(), counters.success.get(), counters.empty.get(), counters.fail.get(), percentOf(counters.processed.get(), total), message, LocalDateTime.now()));
    }

    private String safeTitle(BookVolume volume) {
        return volume.name() == null ? "" : volume.name();
    }

    private int percentOf(int processed, int total) {
        if (total <= 0) return 0;
        return Math.min(100, (int) Math.round((processed * 100.0) / total));
    }

    private static final class RefreshCounters {
        private final AtomicInteger success = new AtomicInteger();
        private final AtomicInteger fail = new AtomicInteger();
        private final AtomicInteger empty = new AtomicInteger();
        private final AtomicInteger processed = new AtomicInteger();
    }

    public record JobStartResult(boolean started, StockRefreshProgress progress, String message) {}

    public record StockRefreshProgress(boolean running, boolean completed, boolean failed, int total, int processed, int success, int empty, int fail, int percent, String message, LocalDateTime updatedAt) {
        public static StockRefreshProgress idle() { return new StockRefreshProgress(false, false, false, 0, 0, 0, 0, 0, 0, "아직 실행한 일괄 갱신 작업이 없습니다.", null); }
        public static StockRefreshProgress running(int total) { return new StockRefreshProgress(true, false, false, total, 0, 0, 0, 0, 0, "미구매권 중고 재고 일괄 갱신을 준비 중입니다.", LocalDateTime.now()); }
        public static StockRefreshProgress completed(int total, int processed, int success, int empty, int fail, String message) { return new StockRefreshProgress(false, true, false, total, processed, success, empty, fail, 100, message, LocalDateTime.now()); }
        public static StockRefreshProgress completed(int total, int success, int empty, int fail, String message) { return completed(total, total, success, empty, fail, message); }
        public static StockRefreshProgress failed(int total, int processed, int success, int empty, int fail, String message) { return new StockRefreshProgress(false, false, true, total, processed, success, empty, fail, total <= 0 ? 0 : Math.min(100, (int) Math.round((processed * 100.0) / total)), message, LocalDateTime.now()); }
    }
}
