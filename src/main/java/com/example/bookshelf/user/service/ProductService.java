package com.example.bookshelf.user.service;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

@Service
public class ProductService {

    private static final Logger log = LoggerFactory.getLogger(ProductService.class);

    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;
    private final BranchInventoryRepository branchInventoryRepository;
    private final AladinUsedStockService aladinUsedStockService;

    public ProductService(BookDataRepository bookDataRepository,
                          BookVolumeRepository bookVolumeRepository,
                          BranchInventoryRepository branchInventoryRepository,
                          AladinUsedStockService aladinUsedStockService) {
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.branchInventoryRepository = branchInventoryRepository;
        this.aladinUsedStockService = aladinUsedStockService;
    }

    public ProductImportResult importProduct(ProductImportCommand command) {
        String normalizedTitle = Texts.trimToNull(command.title());
        String normalizedAuthor = Texts.trimToNull(command.author());
        String keyIsbn = resolveKeyIsbn(command.isbn13(), command.isbn());
        String normalizedType = Texts.trimToNull(command.type());
        String normalizedTotalVolume = Texts.trimToNull(command.totalVolume());
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
            String stockMessage = stockCount < 0 ? " (재고 조회 실패)" : stockCount == 0 ? " (재고 정보 없음)" : " (중고 후보: " + stockCount + "개)";
            return ProductImportResult.success("등록 완료: " + normalizedTitle + stockMessage);
        } catch (DuplicateKeyException e) {
            return ProductImportResult.error("이미 같은 ISBN이 등록되어 있어 추가가 중단되었습니다: " + keyIsbn);
        }
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
                bookDataRepository.updateBook(
                        book.id(),
                        book.name(),
                        book.author(),
                        book.description(),
                        book.cover(),
                        normalizedType != null ? normalizedType : book.type(),
                        normalizedTotalVolume != null ? normalizedTotalVolume : book.totalvolume()
                );
            }
            return BookTarget.success(book.id(), seq);
        }

        Integer existingBookId = bookDataRepository.findBookIdByNameAndAuthor(normalizedTitle, normalizedAuthor);
        if (existingBookId != null) {
            return BookTarget.failure("이미 동일한 제목/저자의 책이 존재합니다. 기존 책으로 추가하려면 상단에서 책을 선택해 주세요. (id:" + existingBookId + ")");
        }

        int bookId = bookDataRepository.insertBook(
                normalizedTitle,
                normalizedAuthor,
                Texts.trimToNull(command.description()),
                command.cover(),
                normalizedType,
                normalizedTotalVolume
        );
        int seq = requestedVolume != null ? requestedVolume : 1;
        return BookTarget.success(bookId, seq);
    }

    private void saveVolume(int bookId, int seq, String keyIsbn, String normalizedTitle, String cover, String price) {
        bookVolumeRepository.insertVolume(bookId, seq, keyIsbn, normalizedTitle, cover, Texts.trimToNull(price));
    }

    private int refreshImportedVolumeStocks(int bookId, int seq, String title, String keyIsbn) {
        try {
            var stocks = aladinUsedStockService.findUsedStocksByIsbn13(keyIsbn);
            if (!stocks.isEmpty()) {
                branchInventoryRepository.insertBranchBooks(bookId, title, seq, stocks);
                branchInventoryRepository.rebuildBranchInventorySummary();
            }
            return stocks.size();
        } catch (RuntimeException e) {
            log.warn("Failed to refresh stocks for imported volume bookId={}, seq={}, isbn13={}", bookId, seq, keyIsbn, e);
            return -1;
        }
    }

    private String resolveKeyIsbn(String isbn13, String isbn) {
        String normalizedIsbn13 = Texts.trimToNull(isbn13);
        return normalizedIsbn13 != null ? normalizedIsbn13 : Texts.trimToNull(isbn);
    }

    private Integer normalizeRequestedVolume(Integer volume) {
        return volume != null && volume > 0 ? volume : null;
    }

    private record BookTarget(boolean success, int bookId, int seq, String message) {
        static BookTarget success(int bookId, int seq) {
            return new BookTarget(true, bookId, seq, null);
        }

        static BookTarget failure(String message) {
            return new BookTarget(false, 0, 0, message);
        }
    }

    public record ProductImportCommand(
            String title,
            String author,
            String cover,
            String isbn13,
            String isbn,
            String price,
            String description,
            Integer targetBookId,
            Integer volume,
            String type,
            String totalVolume
    ) {
    }

    public record ProductImportResult(boolean success, String message) {
        public static ProductImportResult success(String message) {
            return new ProductImportResult(true, message);
        }

        public static ProductImportResult error(String message) {
            return new ProductImportResult(false, message);
        }
    }
}
