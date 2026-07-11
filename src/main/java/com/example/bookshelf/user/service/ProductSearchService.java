package com.example.bookshelf.user.service;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.integration.aladin.AladinSearchResult;
import com.example.bookshelf.integration.aladin.AladinCoverUtils;
import com.example.bookshelf.integration.aladin.AladinSearchService;
import com.example.bookshelf.integration.aladin.AladinSearchViewItem;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.web.viewmodel.ProductSearchViewModel;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ProductSearchService {

    private static final int PAGE_SIZE = 20;
    private static final int PAGE_SIZE_MOBILE = 10;
    private static final int AUTOCOMPLETE_LIMIT = 8;

    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;
    private final AladinSearchService aladinSearchService;

    public ProductSearchService(BookDataRepository bookDataRepository,
                                BookVolumeRepository bookVolumeRepository,
                                AladinSearchService aladinSearchService) {
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.aladinSearchService = aladinSearchService;
    }

    public ProductSearchViewModel search(ProductSearchRequest request) {
        return search(request, null);
    }

    public ProductSearchViewModel search(ProductSearchRequest request, Integer ownerId) {
        String ownedQuery = Texts.trimToEmpty(request.ownedQ());
        String aladinQuery = Texts.trimToEmpty(request.query());
        String ownedSort = normalizeOwnedSort(request.ownedSort());
        int pageSize = resolvePageSize(request.userAgent());
        int requestedOwnedPage = clampPage(request.ownedPage());
        int requestedAladinPage = clampPage(request.aladinPage());

        int totalOwned = ownerId == null
                ? (ownedQuery.isEmpty() ? bookVolumeRepository.countAllBookVolumes() : bookVolumeRepository.countVolumeSearchByKeyword(ownedQuery))
                : (ownedQuery.isEmpty() ? bookVolumeRepository.countAllBookVolumesForOwner(ownerId) : bookVolumeRepository.countVolumeSearchByKeywordForOwner(ownerId, ownedQuery));
        int ownedOffset = (requestedOwnedPage - 1) * pageSize;
        List<BookVolume> ownedVolumes = ownerId == null
                ? (ownedQuery.isEmpty() ? bookVolumeRepository.findAllVolumes(ownedSort, pageSize, ownedOffset) : bookVolumeRepository.searchVolumesByKeyword(ownedQuery, ownedSort, pageSize, ownedOffset))
                : (ownedQuery.isEmpty() ? bookVolumeRepository.findAllVolumesForOwner(ownerId, ownedSort, pageSize, ownedOffset) : bookVolumeRepository.searchVolumesByKeywordForOwner(ownerId, ownedQuery, ownedSort, pageSize, ownedOffset));

        AladinSearchResult aladinResult = aladinQuery.isEmpty()
                ? new AladinSearchResult(List.of(), 0, requestedAladinPage, pageSize)
                : aladinSearchService.searchBookItems(aladinQuery, requestedAladinPage);

        return ProductSearchViewModel.of(
                ownedQuery,
                aladinQuery,
                ownedSort,
                pageSize,
                ownerId == null ? bookDataRepository.findAllBookTypes() : bookDataRepository.findBookTypesForOwner(ownerId),
                ownedVolumes,
                requestedOwnedPage,
                totalOwned,
                requestedAladinPage,
                aladinResult.items().stream()
                        .map(item -> new AladinSearchViewItem(
                                item.title(),
                                item.author(),
                                AladinCoverUtils.toCover500(item.cover()),
                                item.isbn13(),
                                item.isbn(),
                                item.priceSales(),
                                item.priceStandard(),
                                item.pubDate(),
                                item.description(),
                                item.itemId(),
                                item.stockStatus(),
                                item.isbn13() != null && (ownerId == null
                                        ? bookVolumeRepository.existsVolumeByIsbn13(item.isbn13())
                                        : bookVolumeRepository.existsVolumeByIsbn13ForOwner(ownerId, item.isbn13()))
                        ))
                        .toList(),
                aladinResult.totalResults()
        );
    }

    public List<BookAutocompleteItem> autocompleteBooks(String query) {
        return autocompleteBooks(query, null);
    }

    public List<BookAutocompleteItem> autocompleteBooks(String query, Integer ownerId) {
        String keyword = Texts.trimToEmpty(query);
        if (keyword.isEmpty()) {
            return List.of();
        }

        List<Book> books = ownerId == null
                ? bookDataRepository.searchBooksByKeywordOrderByVolumeDesc(keyword, AUTOCOMPLETE_LIMIT, 0)
                : bookDataRepository.searchBooksForOwner(ownerId, keyword, AUTOCOMPLETE_LIMIT);
        if (books.isEmpty() && ownerId == null) {
            books = bookDataRepository.searchBooksByKeywordFallback(keyword, AUTOCOMPLETE_LIMIT, 0);
        }
        return books.stream()
                .map(book -> new BookAutocompleteItem(
                        book.id(),
                        Texts.nullToEmpty(book.name()),
                        Texts.nullToEmpty(book.author()),
                        Texts.nullToEmpty(AladinCoverUtils.toCover500(book.cover())),
                        Texts.nullToEmpty(book.type()),
                        Texts.nullToEmpty(book.totalvolume()),
                        Texts.nullToEmpty(book.createddate()),
                        bookVolumeRepository.nextVolumeSeq(book.id())
                ))
                .toList();
    }

    private int resolvePageSize(String userAgent) {
        return isMobileUserAgent(userAgent) ? PAGE_SIZE_MOBILE : PAGE_SIZE;
    }

    private boolean isMobileUserAgent(String userAgent) {
        if (userAgent == null) {
            return false;
        }
        return userAgent.contains("Mobi")
                || userAgent.contains("Android")
                || userAgent.contains("iPhone")
                || userAgent.contains("iPod")
                || userAgent.contains("Mobile");
    }

    private int clampPage(Integer page) {
        return page == null || page < 1 ? 1 : page;
    }

    private String normalizeOwnedSort(String sort) {
        return "recent".equalsIgnoreCase(sort) ? "recent" : "id";
    }

    public record ProductSearchRequest(String ownedQ, String query, Integer ownedPage, Integer aladinPage, String ownedSort, String userAgent) {
    }

    public record BookAutocompleteItem(int id, String name, String author, String cover, String type, String totalvolume, String createddate, int nextVolume) {
    }
}
