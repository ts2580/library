package com.example.bookshelf.user.service;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.integration.aladin.AladinCoverUtils;
import com.example.bookshelf.integration.aladin.AladinItem;
import com.example.bookshelf.integration.aladin.AladinSearchResult;
import com.example.bookshelf.integration.aladin.AladinSearchService;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class CoverRegenerationService {

    private static final Logger log = LoggerFactory.getLogger(CoverRegenerationService.class);

    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;
    private final AladinSearchService aladinSearchService;
    private final ProductService productService;

    public CoverRegenerationService(BookDataRepository bookDataRepository,
                                    BookVolumeRepository bookVolumeRepository,
                                    AladinSearchService aladinSearchService,
                                    ProductService productService) {
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.aladinSearchService = aladinSearchService;
        this.productService = productService;
    }

    public RegenerationResult regeneratePendingCovers(int ownerId) {
        List<BookVolume> pendingVolumes = bookVolumeRepository.findVolumesPendingCoverGenerationForOwner(ownerId);
        List<Book> pendingBooks = bookDataRepository.findBooksPendingCoverGenerationForOwner(ownerId);
        Map<String, List<AladinItem>> searchCache = new HashMap<>();
        int generatedVolumes = 0;
        int generatedBooks = 0;

        for (BookVolume volume : pendingVolumes) {
            String generatedCover = ensureVolumeCover(volume, searchCache);
            if (productService.isLocalCoverAvailable(generatedCover)) {
                bookVolumeRepository.updateGeneratedCoverForOwner(
                        volume.bookId(), volume.id(), ownerId, generatedCover
                );
                generatedVolumes++;
            }
        }

        for (Book book : pendingBooks) {
            String generatedCover = ensureBookCover(book, searchCache);
            if (productService.isLocalCoverAvailable(generatedCover)) {
                bookDataRepository.updateGeneratedCoverForOwner(book.id(), ownerId, generatedCover);
                generatedBooks++;
            }
        }

        return new RegenerationResult(
                pendingBooks.size(), generatedBooks,
                pendingVolumes.size(), generatedVolumes
        );
    }

    private String ensureVolumeCover(BookVolume volume, Map<String, List<AladinItem>> searchCache) {
        if (productService.isLocalCoverAvailable(volume.cover())) {
            return volume.cover();
        }
        String source = externalCover(volume.cover());
        if (source == null) {
            source = findAladinCover(volume.isbn13(), volume.name(), searchCache);
        }
        if (source == null) {
            return null;
        }
        String key = Texts.trimToNull(volume.isbn13());
        if (key == null) key = "volume_" + volume.id();
        return productService.persistCoverImage(AladinCoverUtils.toCover500(source), key);
    }

    private String ensureBookCover(Book book, Map<String, List<AladinItem>> searchCache) {
        if (productService.isLocalCoverAvailable(book.cover())) {
            return book.cover();
        }

        List<BookVolume> volumes = bookVolumeRepository.findVolumesByBookId(book.id());
        for (BookVolume volume : volumes) {
            if (productService.isLocalCoverAvailable(volume.cover())) {
                return volume.cover();
            }
        }

        String source = externalCover(book.cover());
        String primaryIsbn = volumes.stream()
                .map(BookVolume::isbn13)
                .map(Texts::trimToNull)
                .filter(value -> value != null)
                .findFirst()
                .orElse(null);
        if (source == null) {
            source = findAladinCover(primaryIsbn, book.name(), searchCache);
        }
        if (source == null) {
            return null;
        }
        String key = primaryIsbn == null ? "book_" + book.id() : primaryIsbn + "_book_" + book.id();
        return productService.persistCoverImage(AladinCoverUtils.toCover500(source), key);
    }

    private String findAladinCover(String isbn, String title, Map<String, List<AladinItem>> searchCache) {
        String normalizedIsbn = Texts.trimToNull(isbn);
        String query = normalizedIsbn != null ? normalizedIsbn : Texts.trimToNull(title);
        if (query == null) return null;

        List<AladinItem> items = searchCache.computeIfAbsent(query, this::searchSafely);
        if (normalizedIsbn != null) {
            AladinItem exact = items.stream()
                    .filter(item -> normalizedIsbn.equals(Texts.trimToNull(item.isbn13()))
                            || normalizedIsbn.equals(Texts.trimToNull(item.isbn())))
                    .findFirst()
                    .orElse(null);
            if (exact != null && Texts.trimToNull(exact.cover()) != null) {
                return exact.cover();
            }
        }
        return items.stream()
                .map(AladinItem::cover)
                .map(Texts::trimToNull)
                .filter(value -> value != null)
                .findFirst()
                .orElse(null);
    }

    private List<AladinItem> searchSafely(String query) {
        try {
            AladinSearchResult result = aladinSearchService.searchBookItems(query, 1);
            return result == null || result.items() == null ? List.of() : result.items();
        } catch (RuntimeException e) {
            log.warn("Failed to find an Aladin cover for query={}", query, e);
            return List.of();
        }
    }

    private String externalCover(String cover) {
        String normalized = Texts.trimToNull(cover);
        return normalized != null && (normalized.startsWith("https://") || normalized.startsWith("http://"))
                ? normalized
                : null;
    }

    public record RegenerationResult(
            int pendingBooks,
            int generatedBooks,
            int pendingVolumes,
            int generatedVolumes
    ) {
        public int failedCount() {
            return (pendingBooks - generatedBooks) + (pendingVolumes - generatedVolumes);
        }

        public String summary() {
            return "커버 재생성 완료: 도서 " + generatedBooks + "/" + pendingBooks
                    + "건, 권 " + generatedVolumes + "/" + pendingVolumes + "건"
                    + (failedCount() > 0 ? " (실패 " + failedCount() + "건은 다음 실행에서 재시도)" : "");
        }
    }
}
