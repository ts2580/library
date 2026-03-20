package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinApiService;
import com.example.bookshelf.user.repository.BookRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ProductService {

    private static final Logger log = LoggerFactory.getLogger(ProductService.class);
    private static final int STOCK_REFRESH_BATCH_SIZE = 100;

    private final BookRepository bookRepository;
    private final AladinApiService aladinApiService;

    public ProductService(BookRepository bookRepository,
                          AladinApiService aladinApiService) {
        this.bookRepository = bookRepository;
        this.aladinApiService = aladinApiService;
    }

    public ProductImportResult importProduct(ProductImportCommand command) {
        String normalizedTitle = normalize(command.title());
        String normalizedAuthor = normalize(command.author());
        String finalIsbn13 = normalize(command.isbn13());
        String finalIsbn = normalize(command.isbn());
        String keyIsbn = finalIsbn13 != null ? finalIsbn13 : finalIsbn;

        if (keyIsbn == null || keyIsbn.isEmpty()) {
            return ProductImportResult.error("ISBN13이 없는 항목은 중복 체크가 어려워 임시 등록이 제한됩니다.");
        }

        if (bookRepository.existsVolumeByIsbn13(keyIsbn)) {
            return ProductImportResult.error("이미 같은 ISBN으로 등록된 권이 있습니다: " + keyIsbn);
        }

        int bookId;
        if (command.targetBookId() != null && command.targetBookId() > 0) {
            var book = bookRepository.findBookById(command.targetBookId());
            if (book == null) {
                return ProductImportResult.error("선택한 Book를 찾을 수 없습니다. 새 Book로 등록해 주세요.");
            }
            bookId = command.targetBookId();
        } else {
            Integer existingBookId = bookRepository.findBookIdByNameAndAuthor(normalizedTitle, normalizedAuthor);
            if (existingBookId != null) {
                return ProductImportResult.error("이미 동일한 제목/저자의 책이 존재합니다. 기존 책으로 추가하려면 상단에서 책을 선택해 주세요. (id:" + existingBookId + ")");
            }

            bookId = bookRepository.insertBook(
                    normalizedTitle,
                    normalizedAuthor,
                    normalize(command.description()),
                    command.cover(),
                    null
            );
        }

        try {
            int seq = bookRepository.nextVolumeSeq(bookId);
            bookRepository.insertVolume(
                    bookId,
                    seq,
                    keyIsbn,
                    normalizedTitle,
                    command.cover(),
                    normalize(command.price())
            );

            var stocks = aladinApiService.findUsedStocksByIsbn13(keyIsbn);
            if (!stocks.isEmpty()) {
                bookRepository.insertBranchBooks(bookId, normalizedTitle, seq, stocks);
            }

            String stockMessage = stocks.isEmpty()
                    ? " (재고 정보 없음)"
                    : " (중고 후보: " + stocks.size() + "개)";

            return ProductImportResult.success("등록 완료: " + normalizedTitle + stockMessage);
        } catch (DuplicateKeyException e) {
            return ProductImportResult.error("이미 같은 ISBN이 등록되어 있어 추가가 중단되었어요: " + keyIsbn);
        }
    }

    public StockRefreshResult refreshAllStocks() {
        int total = bookRepository.countUnpurchasedVolumes();
        if (total == 0) {
            return new StockRefreshResult(0, 0, 0, 0, "조회할 미구매 항목이 없습니다. (ispurchased = false)");
        }

        int success = 0;
        int fail = 0;
        int empty = 0;
        int lastSeenId = 0;

        while (true) {
            List<com.example.bookshelf.user.model.BookVolume> volumes = bookRepository.findUnpurchasedVolumesAfterId(lastSeenId, STOCK_REFRESH_BATCH_SIZE);
            if (volumes.isEmpty()) {
                break;
            }

            for (var volume : volumes) {
                lastSeenId = volume.id();
                String isbn13 = volume.isbn13() == null ? null : volume.isbn13().trim();
                if (isbn13 == null || isbn13.isEmpty()) {
                    fail++;
                    continue;
                }

                try {
                    var stocks = aladinApiService.findUsedStocksByIsbn13(isbn13);
                    if (!stocks.isEmpty()) {
                        bookRepository.deleteBranchBooksByBookAndVolume(volume.bookId(), volume.seq());
                    }
                    if (stocks.isEmpty()) {
                        empty++;
                        continue;
                    }
                    String title = volume.name() == null ? "" : volume.name();
                    bookRepository.insertBranchBooks(volume.bookId(), title, volume.seq(), stocks);
                    success++;
                } catch (RuntimeException e) {
                    fail++;
                    log.warn("Failed to refresh stocks for bookId={}, seq={}, isbn13={}", volume.bookId(), volume.seq(), isbn13, e);
                }
            }
        }

        String message = "재고 일괄 조회 완료: 총 " + total + "권 중 " + success + "권 성공, " + empty + "권 재고없음, " + fail + "권 실패";
        return new StockRefreshResult(total, success, empty, fail, message);
    }

    private String normalize(String value) {
        return (value == null || value.trim().isEmpty()) ? null : value.trim();
    }

    public record ProductImportCommand(
            String title,
            String author,
            String cover,
            String isbn13,
            String isbn,
            String price,
            String description,
            Integer targetBookId
    ) {}

    public record ProductImportResult(boolean success, String message) {
        public static ProductImportResult success(String message) {
            return new ProductImportResult(true, message);
        }

        public static ProductImportResult error(String message) {
            return new ProductImportResult(false, message);
        }
    }

    public record StockRefreshResult(int total, int success, int empty, int fail, String message) {}
}
