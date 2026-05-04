package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinApiService;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class ProductService {

    private static final Logger log = LoggerFactory.getLogger(ProductService.class);
    private static final int STOCK_REFRESH_BATCH_SIZE = 100;

    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;
    private final BranchInventoryRepository branchInventoryRepository;
    private final AladinApiService aladinApiService;
    private final ExecutorService refreshExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "bookshelf-stock-refresh");
        thread.setDaemon(true);
        return thread;
    });

    private final AtomicBoolean refreshRunning = new AtomicBoolean(false);
    private final AtomicReference<StockRefreshProgress> refreshProgress = new AtomicReference<>(StockRefreshProgress.idle());

    public ProductService(BookDataRepository bookDataRepository,
                          BookVolumeRepository bookVolumeRepository,
                          BranchInventoryRepository branchInventoryRepository,
                          AladinApiService aladinApiService) {
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.branchInventoryRepository = branchInventoryRepository;
        this.aladinApiService = aladinApiService;
    }

    public ProductImportResult importProduct(ProductImportCommand command) {
        String normalizedTitle = normalize(command.title());
        String normalizedAuthor = normalize(command.author());
        String keyIsbn = resolveKeyIsbn(command.isbn13(), command.isbn());
        String normalizedType = normalize(command.type());
        String normalizedTotalVolume = normalize(command.totalVolume());
        Integer requestedVolume = normalizeRequestedVolume(command.volume());

        if (keyIsbn == null || keyIsbn.isEmpty()) {
            return ProductImportResult.error("ISBN13이 없는 항목은 중복 체크가 어려워 임시 등록이 제한됩니다.");
        }
        if (bookVolumeRepository.existsVolumeByIsbn13(keyIsbn)) {
            return ProductImportResult.error("이미 같은 ISBN으로 등록된 권이 있습니다: " + keyIsbn);
        }

        BookTarget target = resolveBookTarget(command, normalizedTitle, normalizedAuthor, normalizedType, normalizedTotalVolume, requestedVolume);
        if (!target.success()) {
            return ProductImportResult.error(target.message());
        }

        try {
            saveVolume(target.bookId(), target.seq(), keyIsbn, normalizedTitle, command.cover(), command.price());
            int stockCount = refreshImportedVolumeStocks(target.bookId(), target.seq(), normalizedTitle, keyIsbn);
            String stockMessage = stockCount == 0 ? " (재고 정보 없음)" : " (중고 후보: " + stockCount + "개)";
            return ProductImportResult.success("등록 완료: " + normalizedTitle + stockMessage);
        } catch (DuplicateKeyException e) {
            return ProductImportResult.error("이미 같은 ISBN이 등록되어 있어 추가가 중단되었어요: " + keyIsbn);
        }
    }

    public JobStartResult startStockRefreshJob() {
        if (refreshRunning.get()) {
            return new JobStartResult(false, refreshProgress.get(), "이미 일괄 갱신이 진행 중이에요.");
        }

        int total = bookVolumeRepository.countUnpurchasedVolumes();
        if (total == 0) {
            StockRefreshProgress idle = StockRefreshProgress.completed(0, 0, 0, 0, "조회할 미구매 항목이 없습니다. (ispurchased = false)");
            refreshProgress.set(idle);
            return new JobStartResult(false, idle, idle.message());
        }

        refreshProgress.set(StockRefreshProgress.running(total));
        refreshRunning.set(true);
        refreshExecutor.submit(() -> runStockRefreshJob(total));
        return new JobStartResult(true, refreshProgress.get(), "미구매권 중고 재고 일괄 갱신을 시작했어요.");
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
            refreshProgress.set(StockRefreshProgress.failed(total, counters.processed.get(), counters.success.get(), counters.empty.get(), counters.fail.get(), "일괄 갱신 중 오류가 발생했어요: " + e.getMessage()));
        } finally {
            refreshRunning.set(false);
        }
    }

    private List<BookVolume> fetchRefreshBatch(int lastSeenId) {
        return bookVolumeRepository.findUnpurchasedVolumesAfterId(lastSeenId, STOCK_REFRESH_BATCH_SIZE);
    }

    private int processRefreshBatch(List<BookVolume> volumes, int total, RefreshCounters counters) {
        int lastSeenId = 0;
        for (BookVolume volume : volumes) {
            lastSeenId = volume.id();
            processSingleRefreshTarget(volume, total, counters);
        }
        return lastSeenId;
    }

    private void processSingleRefreshTarget(BookVolume volume, int total, RefreshCounters counters) {
        String isbn13 = volume.isbn13();
        if (isbn13 == null || isbn13.isEmpty()) {
            counters.fail.incrementAndGet();
            counters.processed.incrementAndGet();
            publishRefreshProgress(total, counters, "ISBN13이 없는 항목을 건너뛰는 중이에요.");
            return;
        }

        try {
            List<AladinBranchStock> stocks = aladinApiService.findUsedStocksByIsbn13(isbn13);
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
        publishRefreshProgress(total, counters, "미구매권 중고 재고를 갱신 중이에요. (" + counters.processed.get() + "/" + total + ")");
    }

    private void rebuildSummaryAfterRefresh(int total, RefreshCounters counters) {
        publishRefreshProgress(total, counters, "차트용 집계 테이블을 갱신하는 중이에요.");
        branchInventoryRepository.rebuildBranchInventorySummary();
        String message = "재고 일괄 조회 완료: 총 " + total + "권 중 " + counters.success.get() + "권 성공, " + counters.empty.get() + "권 재고없음, " + counters.fail.get() + "권 실패";
        refreshProgress.set(StockRefreshProgress.completed(total, counters.processed.get(), counters.success.get(), counters.empty.get(), counters.fail.get(), message));
    }

    private void publishRefreshProgress(int total, RefreshCounters counters, String message) {
        refreshProgress.set(new StockRefreshProgress(true, false, false, total, counters.processed.get(), counters.success.get(), counters.empty.get(), counters.fail.get(), percentOf(counters.processed.get(), total), message, LocalDateTime.now()));
    }

    private BookTarget resolveBookTarget(ProductImportCommand command,
                                         String normalizedTitle,
                                         String normalizedAuthor,
                                         String normalizedType,
                                         String normalizedTotalVolume,
                                         Integer requestedVolume) {
        if (command.targetBookId() != null && command.targetBookId() > 0) {
            Book book = bookDataRepository.findBookById(command.targetBookId());
            if (book == null) {
                return BookTarget.failure("선택한 Book를 찾을 수 없습니다. 새 Book로 등록해 주세요.");
            }
            int seq = requestedVolume != null ? requestedVolume : bookVolumeRepository.nextVolumeSeq(book.id());
            if (normalizedType != null || normalizedTotalVolume != null) {
                bookDataRepository.updateBook(book.id(), book.name(), book.author(), book.description(), book.cover(), normalizedType != null ? normalizedType : book.type(), normalizedTotalVolume != null ? normalizedTotalVolume : book.totalvolume());
            }
            return BookTarget.success(book.id(), seq);
        }

        Integer existingBookId = bookDataRepository.findBookIdByNameAndAuthor(normalizedTitle, normalizedAuthor);
        if (existingBookId != null) {
            return BookTarget.failure("이미 동일한 제목/저자의 책이 존재합니다. 기존 책으로 추가하려면 상단에서 책을 선택해 주세요. (id:" + existingBookId + ")");
        }

        int bookId = bookDataRepository.insertBook(normalizedTitle, normalizedAuthor, normalize(command.description()), command.cover(), normalizedType, normalizedTotalVolume);
        int seq = requestedVolume != null ? requestedVolume : 1;
        return BookTarget.success(bookId, seq);
    }

    private void saveVolume(int bookId, int seq, String keyIsbn, String normalizedTitle, String cover, String price) {
        bookVolumeRepository.insertVolume(bookId, seq, keyIsbn, normalizedTitle, cover, normalize(price));
    }

    private int refreshImportedVolumeStocks(int bookId, int seq, String title, String keyIsbn) {
        var stocks = aladinApiService.findUsedStocksByIsbn13(keyIsbn);
        if (!stocks.isEmpty()) {
            branchInventoryRepository.insertBranchBooks(bookId, title, seq, stocks);
            branchInventoryRepository.rebuildBranchInventorySummary();
        }
        return stocks.size();
    }

    private String safeTitle(BookVolume volume) {
        return volume.name() == null ? "" : volume.name();
    }

    private String resolveKeyIsbn(String isbn13, String isbn) {
        if (isbn13 != null && !isbn13.isEmpty()) {
            return isbn13;
        }
        return isbn;
    }

    private Integer normalizeRequestedVolume(Integer volume) {
        return volume != null && volume > 0 ? volume : null;
    }

    private int percentOf(int processed, int total) {
        if (total <= 0) return 0;
        return Math.min(100, (int) Math.round((processed * 100.0) / total));
    }

    private String normalize(String value) {
        return (value == null || value.trim().isEmpty()) ? null : value.trim();
    }

    private static final class RefreshCounters {
        private final AtomicInteger success = new AtomicInteger();
        private final AtomicInteger fail = new AtomicInteger();
        private final AtomicInteger empty = new AtomicInteger();
        private final AtomicInteger processed = new AtomicInteger();
    }

    private record BookTarget(boolean success, int bookId, int seq, String message) {
        static BookTarget success(int bookId, int seq) { return new BookTarget(true, bookId, seq, null); }
        static BookTarget failure(String message) { return new BookTarget(false, 0, 0, message); }
    }

    public record ProductImportCommand(String title, String author, String cover, String isbn13, String isbn, String price, String description, Integer targetBookId, Integer volume, String type, String totalVolume) {}
    public record ProductImportResult(boolean success, String message) {
        public static ProductImportResult success(String message) { return new ProductImportResult(true, message); }
        public static ProductImportResult error(String message) { return new ProductImportResult(false, message); }
    }
    public record JobStartResult(boolean started, StockRefreshProgress progress, String message) {}
    public record StockRefreshProgress(boolean running, boolean completed, boolean failed, int total, int processed, int success, int empty, int fail, int percent, String message, LocalDateTime updatedAt) {
        public static StockRefreshProgress idle() { return new StockRefreshProgress(false, false, false, 0, 0, 0, 0, 0, 0, "아직 실행한 일괄 갱신 작업이 없어요.", null); }
        public static StockRefreshProgress running(int total) { return new StockRefreshProgress(true, false, false, total, 0, 0, 0, 0, 0, "미구매권 중고 재고 일괄 갱신을 준비 중이에요.", LocalDateTime.now()); }
        public static StockRefreshProgress completed(int total, int processed, int success, int empty, int fail, String message) { return new StockRefreshProgress(false, true, false, total, processed, success, empty, fail, 100, message, LocalDateTime.now()); }
        public static StockRefreshProgress completed(int total, int success, int empty, int fail, String message) { return completed(total, total, success, empty, fail, message); }
        public static StockRefreshProgress failed(int total, int processed, int success, int empty, int fail, String message) { return new StockRefreshProgress(false, false, true, total, processed, success, empty, fail, total <= 0 ? 0 : Math.min(100, (int) Math.round((processed * 100.0) / total)), message, LocalDateTime.now()); }
    }
}
