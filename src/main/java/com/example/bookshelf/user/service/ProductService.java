package com.example.bookshelf.user.service;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.integration.aladin.AladinCoverUtils;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.NoTransactionException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;

import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.List;

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

    @Transactional
    public int migrateOldCovers() {
        int count = 0;
        List<Book> books = bookDataRepository.findAllBooks();
        for (Book book : books) {
            List<BookVolume> volumes = bookVolumeRepository.findVolumesByBookId(book.id());
            String bookCoverCacheKey = resolveBookCoverCacheKey(book.id(), volumes);
            if (book.cover() != null && book.cover().startsWith("http")) {
                String newCover = downloadCoverImage(book.cover(), bookCoverCacheKey);
                if (!newCover.equals(book.cover())) {
                    bookDataRepository.updateBook(book.id(), book.name(), book.author(), book.description(), newCover, book.type(), book.totalvolume());
                    count++;
                }
            }

            for (BookVolume volume : volumes) {
                if (volume.cover() != null && volume.cover().startsWith("http")) {
                    String vCover = downloadCoverImage(volume.cover(), volume.isbn13() != null ? volume.isbn13() : "vol_" + volume.id());
                    if (!vCover.equals(volume.cover())) {
                        bookVolumeRepository.updateVolume(book.id(), volume.id(), volume.isbn13(), volume.name(), vCover, volume.price(), volume.description(), volume.purchased(), volume.noNeedToBuy(), volume.seq());
                        count++;
                    }
                }
            }
        }
        return count;
    }

    @Transactional
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

        String localCoverUrl = downloadCoverImage(command.cover(), keyIsbn);

        BookTarget target = resolveBookTarget(command, normalizedTitle, normalizedAuthor, normalizedType, normalizedTotalVolume, requestedVolume, localCoverUrl);
        if (!target.success()) {
            return ProductImportResult.error(target.message());
        }

        try {
            saveVolume(target.bookId(), target.seq(), keyIsbn, normalizedTitle, localCoverUrl, command.price(), command.description());
            int stockCount = refreshImportedVolumeStocks(target.bookId(), target.seq(), normalizedTitle, keyIsbn);
            String stockMessage = stockCount < 0 ? " (재고 조회 실패)" : stockCount == 0 ? " (재고 정보 없음)" : " (중고 후보: " + stockCount + "개)";
            return ProductImportResult.success("등록 완료: " + normalizedTitle + stockMessage);
        } catch (DuplicateKeyException e) {
            markRollbackOnlyIfTransactional();
            return ProductImportResult.error("이미 같은 ISBN 또는 권 번호가 등록되어 있어 추가가 중단되었습니다: " + keyIsbn);
        }
    }

    private BookTarget resolveBookTarget(ProductImportCommand command,
                                         String normalizedTitle,
                                         String normalizedAuthor,
                                         String normalizedType,
                                         String normalizedTotalVolume,
                                         Integer requestedVolume,
                                         String localCoverUrl) {
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
                localCoverUrl,
                normalizedType,
                normalizedTotalVolume
        );
        int seq = requestedVolume != null ? requestedVolume : 1;
        return BookTarget.success(bookId, seq);
    }

    private void saveVolume(int bookId, int seq, String keyIsbn, String normalizedTitle, String cover, String price, String description) {
        bookVolumeRepository.insertVolume(bookId, seq, keyIsbn, normalizedTitle, cover, Texts.trimToNull(price), Texts.trimToNull(description));
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

    private String resolveBookCoverCacheKey(int bookId, List<BookVolume> volumes) {
        if (volumes != null) {
            for (BookVolume volume : volumes) {
                if (volume == null) continue;
                String isbn13 = Texts.trimToNull(volume.isbn13());
                if (isbn13 != null) {
                    return isbn13 + "_book_" + bookId;
                }
            }
        }
        return "book_" + bookId;
    }

    private String downloadCoverImage(String coverUrl, String isbn) {
        if (coverUrl == null || coverUrl.isEmpty() || coverUrl.startsWith("/covers/")) {
            return coverUrl;
        }
        String highResUrl = AladinCoverUtils.toCover500(coverUrl);
        try {
            Path uploadDir = Paths.get("./data/covers");
            if (!Files.exists(uploadDir)) {
                Files.createDirectories(uploadDir);
            }
            
            String extension = ".jpg";
            if (coverUrl.contains(".")) {
                String ext = coverUrl.substring(coverUrl.lastIndexOf("."));
                if (ext.length() <= 5 && !ext.contains("/") && !ext.contains("?")) {
                    extension = ext;
                }
            }
            
            String filename = (isbn != null && !isbn.isEmpty() ? isbn : System.currentTimeMillis()) + extension;
            Path filePath = uploadDir.resolve(filename);
            
            boolean downloaded = false;
            if (!highResUrl.equals(coverUrl)) {
                try (InputStream in = new URL(highResUrl).openStream()) {
                    Files.copy(in, filePath, StandardCopyOption.REPLACE_EXISTING);
                    downloaded = true;
                } catch (Exception ignored) {
                    // Fallback to original url if high-res download fails
                }
            }
            
            if (!downloaded) {
                try (InputStream in = new URL(coverUrl).openStream()) {
                    Files.copy(in, filePath, StandardCopyOption.REPLACE_EXISTING);
                }
            }
            return "/covers/" + filename;
        } catch (Exception e) {
            log.warn("Failed to download cover image from URL: {}", coverUrl, e);
            return highResUrl;
        }
    }

    private Integer normalizeRequestedVolume(Integer volume) {
        return volume != null && volume > 0 ? volume : null;
    }

    public String persistCoverImage(String coverUrl, String fileKey) {
        return downloadCoverImage(coverUrl, fileKey);
    }

    private void markRollbackOnlyIfTransactional() {
        try {
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        } catch (NoTransactionException ignored) {
            // Unit tests instantiate the service without a Spring transaction.
        }
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
