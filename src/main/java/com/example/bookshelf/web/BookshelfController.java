package com.example.bookshelf.web;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.integration.aladin.AladinItem;
import com.example.bookshelf.user.service.BookCatalogService;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.integration.aladin.AladinCoverUtils;
import com.example.bookshelf.web.viewmodel.BookDetailViewModel;
import com.example.bookshelf.web.viewmodel.BookListViewModel;
import org.springframework.stereotype.Controller;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Controller
public class BookshelfController {

    private final BookCatalogService bookCatalogService;
    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;
    private final com.example.bookshelf.integration.aladin.AladinSearchService aladinSearchService;
    private final com.example.bookshelf.user.service.ProductService productService;
    private final AuthSessionHelper authSessionHelper;

    @Autowired
    public BookshelfController(BookCatalogService bookCatalogService,
                               BookDataRepository bookDataRepository,
                               BookVolumeRepository bookVolumeRepository,
                               com.example.bookshelf.integration.aladin.AladinSearchService aladinSearchService,
                               com.example.bookshelf.user.service.ProductService productService,
                               AuthSessionHelper authSessionHelper) {
        this.bookCatalogService = bookCatalogService;
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.aladinSearchService = aladinSearchService;
        this.productService = productService;
        this.authSessionHelper = authSessionHelper;
    }

    public BookshelfController(BookCatalogService bookCatalogService,
                               BookDataRepository bookDataRepository,
                               BookVolumeRepository bookVolumeRepository,
                               com.example.bookshelf.integration.aladin.AladinSearchService aladinSearchService,
                               com.example.bookshelf.user.service.ProductService productService) {
        this(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService, null);
    }

    @RequestMapping("/books")
    public String list(@RequestParam(value = "search", required = false) String search,
                       @RequestParam(value = "page", defaultValue = "1") Integer page,
                       @RequestParam(value = "type", required = false) String type,
                       @RequestParam(value = "title", required = false) String title,
                       @RequestParam(value = "author", required = false) String author,
                       Model model) {
        applyBookListModel(model, bookCatalogService.findBookList(search, type, title, author, page, currentOwnerId()));
        return "book_list";
    }

    @PostMapping("/api/migration/covers")
    public String migrateCovers(RedirectAttributes redirectAttributes) {
        int count = productService.migrateOldCovers();
        redirectAttributes.addFlashAttribute("success", count + "개의 표지 이미지를 다운로드하여 업데이트했습니다.");
        return "redirect:/books";
    }

    @PostMapping("/books")
    public String createBook(@RequestParam("name") String name,
                             @RequestParam(value = "author", required = false) String author,
                             @RequestParam(value = "description", required = false) String description,
                             @RequestParam(value = "cover", required = false) String cover,
                             @RequestParam(value = "type", required = false) String type,
                             @RequestParam(value = "totalvolume", required = false) String totalVolume,
                             RedirectAttributes redirectAttributes) {
        if (name == null || name.isBlank()) {
            redirectAttributes.addFlashAttribute("error", "책 제목을 입력해 주세요.");
            return "redirect:/books";
        }

        com.example.bookshelf.integration.aladin.AladinSearchResult aladinResult = aladinSearchService.searchBookItems(name, 1);
        List<com.example.bookshelf.integration.aladin.AladinItem> items = aladinResult.items();
        String primaryIsbn13 = resolvePrimaryIsbn13FromItems(items);

        if (items != null && !items.isEmpty()) {
            com.example.bookshelf.integration.aladin.AladinItem vol1 = items.stream()
                    .filter(item -> item.title() != null && item.title().contains("1권"))
                    .findFirst()
                    .orElse(items.get(0));
            if (cover == null || cover.isBlank()) {
                cover = AladinCoverUtils.toCover500(vol1.cover());
            } else {
                cover = AladinCoverUtils.toCover500(cover);
            }
            if (description == null || description.isBlank()) description = vol1.description();
            if (author == null || author.isBlank()) author = vol1.author();
        }
        cover = AladinCoverUtils.toCover500(cover);

        Integer ownerId = currentOwnerId();
        int bookId = ownerId == null
                ? bookDataRepository.insertBook(name, author, description, cover, type, totalVolume)
                : bookDataRepository.insertBookForOwner(ownerId, name, author, description, cover, type, totalVolume);
        String persistedBookCover = persistExternalCover(cover, resolveBookCoverCacheKey(bookId, primaryIsbn13));
        if (persistedBookCover == null ? cover != null : !persistedBookCover.equals(cover)) {
            bookDataRepository.updateBook(bookId, name, author, description, persistedBookCover, type, totalVolume);
            cover = persistedBookCover;
        }

        if (items != null) {
            int seq = 1;
            for (com.example.bookshelf.integration.aladin.AladinItem item : items) {
                String isbn13 = item.isbn13();
                if (isbn13 == null || isbn13.isBlank()) isbn13 = item.isbn();
                boolean alreadyOwned = ownerId == null
                        ? bookVolumeRepository.existsVolumeByIsbn13(isbn13)
                        : bookVolumeRepository.existsVolumeByIsbn13ForOwner(ownerId, isbn13);
                if (isbn13 != null && !isbn13.isBlank() && !alreadyOwned) {
                    String itemCover = persistExternalCover(AladinCoverUtils.toCover500(item.cover()), isbn13);
                    bookVolumeRepository.insertVolume(bookId, seq++, isbn13, item.title(), itemCover, item.priceSales(), item.description());
                }
            }
        }

        redirectAttributes.addFlashAttribute("success", "책을 추가했습니다.");
        return "redirect:/books/" + bookId;
    }

    @GetMapping("/books/{id}")
    public String detail(@PathVariable int id, Model model) {
        var book = findAccessibleBook(id);
        if (book == null) return "redirect:/books";

        BookDetailViewModel vm = BookDetailViewModel.forDisplay(
                book,
                bookVolumeRepository.findVolumesByBookId(id),
                bookDataRepository.findAllBookTypes()
        );
        model.addAttribute("vm", vm);
        model.addAttribute("book", vm.book());
        model.addAttribute("volumes", vm.volumes());
        model.addAttribute("bookTypes", vm.bookTypes());
        return "book_detail";
    }

    @PostMapping("/books/{id}")
    public String updateBook(@PathVariable int id,
                             @RequestParam(value = "name", required = false) String name,
                             @RequestParam(value = "author", required = false) String author,
                             @RequestParam(value = "description", required = false) String description,
                             @RequestParam(value = "cover", required = false) String cover,
                             @RequestParam(value = "type", required = false) String type,
                             @RequestParam(value = "totalvolume", required = false) String ignoredTotalVolume,
                             RedirectAttributes redirectAttributes) {
        var book = findAccessibleBook(id);
        if (book == null) return "redirect:/books";

        String bookCoverCacheKey = resolveBookCoverCacheKey(id, resolveBookPrimaryVolumeIsbn13(id));
        cover = persistExternalCover(cover, bookCoverCacheKey);
        String calculatedTotalVolume = String.valueOf(bookVolumeRepository.findVolumesByBookId(id).size());
        bookDataRepository.updateBook(id, name, author, description, cover, type, calculatedTotalVolume);
        redirectAttributes.addFlashAttribute("success", "책 정보를 수정했습니다.");
        return "redirect:/books/" + id;
    }

    @PostMapping("/books/{id}/volumes/{volumeId}")
    public String updateVolume(@PathVariable int id,
                               @PathVariable int volumeId,
                               @RequestParam(value = "isbn13", required = false) String isbn13,
                               @RequestParam(value = "name", required = false) String name,
                               @RequestParam(value = "cover", required = false) String cover,
                               @RequestParam(value = "price", required = false) String price,
                               @RequestParam(value = "description", required = false) String description,
                               @RequestParam(value = "purchased", defaultValue = "false") boolean purchased,
                               @RequestParam(value = "noNeedToBuy", defaultValue = "false") boolean noNeedToBuy,
                               @RequestParam(value = "seq", required = false) Integer seq,
                               @RequestParam(value = "type", required = false) String type,
                               RedirectAttributes redirectAttributes) {
        var book = findAccessibleBook(id);
        if (book == null) return "redirect:/books";

        cover = persistExternalCover(cover, normalizeVolumeCoverKey(volumeId, isbn13));
        bookVolumeRepository.updateVolume(id, volumeId, isbn13, name, cover, price, description, purchased, noNeedToBuy, seq);
        if (type != null && !type.trim().isEmpty()) {
            String calculatedTotalVolume = String.valueOf(bookVolumeRepository.findVolumesByBookId(id).size());
            bookDataRepository.updateBook(id, book.name(), book.author(), book.description(), book.cover(), type, calculatedTotalVolume);
        }
        redirectAttributes.addFlashAttribute("success", "권 정보를 수정했습니다.");
        return "redirect:/books/" + id;
    }

    @PostMapping("/books/{id}/enrich-info")
    public String enrichBookInfo(@PathVariable int id, RedirectAttributes redirectAttributes) {
        Book book = findAccessibleBook(id);
        if (book == null) return "redirect:/books";

        List<BookVolume> volumes = bookVolumeRepository.findVolumesByBookId(id);
        if (!isBlank(book.author()) && !isBlank(book.description()) && volumes.stream().noneMatch(this::needsVolumeInfo)) {
            redirectAttributes.addFlashAttribute("success", "채울 저자/설명이 없습니다.");
            return "redirect:/books/" + id;
        }

        Map<String, List<AladinItem>> searchCache = new HashMap<>();
        int updatedVolumeCount = enrichMissingVolumeDescriptions(id, volumes, searchCache);
        BookInfoPatch bookPatch = resolveBookInfoPatch(book, volumes, searchCache);
        int updatedBookCount = applyBookInfoPatch(book, bookPatch);

        if (updatedBookCount == 0 && updatedVolumeCount == 0) {
            redirectAttributes.addFlashAttribute("error", "채울 수 있는 Aladin 정보가 없습니다.");
        } else {
            redirectAttributes.addFlashAttribute("success", "정보 보강 완료: 책 " + updatedBookCount + "건, 권 " + updatedVolumeCount + "건");
        }
        return "redirect:/books/" + id;
    }

    @PostMapping("/books/{id}/delete")
    @Transactional
    public String deleteBook(@PathVariable int id, RedirectAttributes redirectAttributes) {
        var book = findAccessibleBook(id);
        if (book == null) return "redirect:/books";
        List<String> deletedCoverUrls = new ArrayList<>();
        deletedCoverUrls.add(book.cover());
        bookVolumeRepository.findVolumesByBookId(id).stream()
                .map(com.example.bookshelf.user.model.BookVolume::cover)
                .forEach(deletedCoverUrls::add);

        bookVolumeRepository.deleteVolumesByBookId(id);
        bookDataRepository.deleteBookById(id);
        productService.deleteLocalCoverFilesIfUnused(deletedCoverUrls);
        redirectAttributes.addFlashAttribute("success", "도서를 삭제했습니다. (" + book.name() + ")");
        return "redirect:/books";
    }

    @PostMapping("/books/{id}/volumes/delete")
    @Transactional
    public String deleteVolumes(@PathVariable int id,
                                @RequestParam(value = "volumeIds", required = false) List<Integer> volumeIds,
                                RedirectAttributes redirectAttributes) {
        var book = findAccessibleBook(id);
        if (book == null) return "redirect:/books";
        if (volumeIds == null || volumeIds.isEmpty()) {
            redirectAttributes.addFlashAttribute("error", "삭제할 권을 선택해 주세요.");
            return "redirect:/books/" + id;
        }
        Set<Integer> selectedVolumeIds = volumeIds.stream().collect(Collectors.toSet());
        List<String> deletedCoverUrls = bookVolumeRepository.findVolumesByBookId(id).stream()
                .filter(volume -> selectedVolumeIds.contains(volume.id()))
                .map(com.example.bookshelf.user.model.BookVolume::cover)
                .toList();

        bookVolumeRepository.deleteVolumesByBookAndIds(id, volumeIds);
        productService.deleteLocalCoverFilesIfUnused(deletedCoverUrls);
        redirectAttributes.addFlashAttribute("success", volumeIds.size() + "개 권을 삭제했습니다.");
        return "redirect:/books/" + id;
    }

    private void applyBookListModel(Model model, BookListViewModel vm) {
        model.addAttribute("search", vm.search());
        model.addAttribute("type", vm.type());
        model.addAttribute("title", vm.title());
        model.addAttribute("author", vm.author());
        model.addAttribute("hasAdvancedFilters", vm.hasAdvancedFilters());
        model.addAttribute("types", vm.types());
        model.addAttribute("books", vm.books());
        model.addAttribute("page", vm.page().currentPage());
        model.addAttribute("pageSize", vm.page().pageSize());
        model.addAttribute("totalCount", vm.page().totalItems());
        model.addAttribute("totalPages", vm.page().totalPages());
        model.addAttribute("from", vm.page().from());
        model.addAttribute("to", vm.page().to());
        model.addAttribute("startPage", vm.page().startPage());
        model.addAttribute("endPage", vm.page().endPage());
    }

    private Integer currentOwnerId() {
        return authSessionHelper == null ? null : authSessionHelper.getMemberId(null);
    }

    private Book findAccessibleBook(int bookId) {
        Integer ownerId = currentOwnerId();
        return ownerId == null
                ? bookDataRepository.findBookById(bookId)
                : bookDataRepository.findBookByIdForOwner(bookId, ownerId);
    }

    private String persistExternalCover(String cover, String cacheKey) {
        String normalizedCover = AladinCoverUtils.toCover500(cover);
        if (normalizedCover == null || !normalizedCover.startsWith("http") || cacheKey == null || cacheKey.isBlank() || productService == null) {
            return normalizedCover;
        }
        return productService.persistCoverImage(normalizedCover, cacheKey);
    }

    private String resolvePrimaryIsbn13FromItems(List<com.example.bookshelf.integration.aladin.AladinItem> items) {
        if (items == null || items.isEmpty()) {
            return null;
        }
        for (com.example.bookshelf.integration.aladin.AladinItem item : items) {
            String isbn13 = Texts.trimToNull(item.isbn13());
            if (isbn13 != null) {
                return isbn13;
            }
        }
        return null;
    }

    private String resolveBookPrimaryVolumeIsbn13(int bookId) {
        return bookVolumeRepository.findVolumesByBookId(bookId).stream()
                .map(volume -> Texts.trimToNull(volume.isbn13()))
                .filter(isbn13 -> isbn13 != null && !isbn13.isBlank())
                .findFirst()
                .orElse(null);
    }

    private String resolveBookCoverCacheKey(int bookId, String isbn13) {
        return isbn13 != null && !isbn13.isBlank() ? isbn13 + "_book_" + bookId : "book_" + bookId;
    }

    private static String normalizeVolumeCoverKey(int volumeId, String isbn13) {
        if (isbn13 != null && !isbn13.isBlank()) {
            return isbn13;
        }
        return "volume_" + volumeId;
    }

    private int enrichMissingVolumeDescriptions(int bookId, List<BookVolume> volumes, Map<String, List<AladinItem>> searchCache) {
        int updated = 0;
        for (BookVolume volume : volumes) {
            if (!needsVolumeInfo(volume)) {
                continue;
            }
            AladinItem item = findBestAladinItem(volume, searchCache);
            String description = firstNonBlank(volume.description(), item == null ? null : item.description());
            if (Objects.equals(Texts.trimToNull(description), Texts.trimToNull(volume.description()))) {
                continue;
            }
            bookVolumeRepository.updateVolume(
                    bookId,
                    volume.id(),
                    volume.isbn13(),
                    volume.name(),
                    volume.cover(),
                    volume.price(),
                    description,
                    volume.purchased(),
                    volume.noNeedToBuy(),
                    volume.seq()
            );
            updated++;
        }
        return updated;
    }

    private BookInfoPatch resolveBookInfoPatch(Book book, List<BookVolume> volumes, Map<String, List<AladinItem>> searchCache) {
        if (!isBlank(book.author()) && !isBlank(book.description())) {
            return BookInfoPatch.empty();
        }

        AladinItem source = findFirstVolumeItem(volumes, searchCache);
        if (source == null) {
            source = findFirstUsefulItem(searchByQuery(book.name(), searchCache));
        }
        if (source == null) {
            return BookInfoPatch.empty();
        }
        return new BookInfoPatch(
                isBlank(book.author()) ? Texts.trimToNull(source.author()) : null,
                isBlank(book.description()) ? Texts.trimToNull(source.description()) : null
        );
    }

    private int applyBookInfoPatch(Book book, BookInfoPatch patch) {
        if (!patch.hasChanges()) {
            return 0;
        }
        bookDataRepository.updateBook(
                book.id(),
                book.name(),
                firstNonBlank(book.author(), patch.author()),
                firstNonBlank(book.description(), patch.description()),
                book.cover(),
                book.type(),
                book.totalvolume()
        );
        return 1;
    }

    private AladinItem findFirstVolumeItem(List<BookVolume> volumes, Map<String, List<AladinItem>> searchCache) {
        return volumes.stream()
                .filter(volume -> volume.seq() == 1 || "1".equals(Texts.trimToNull(volume.volume())))
                .sorted(Comparator.comparingInt(BookVolume::seq))
                .map(volume -> findBestAladinItem(volume, searchCache))
                .filter(Objects::nonNull)
                .findFirst()
                .orElseGet(() -> volumes.stream()
                        .sorted(Comparator.comparingInt(BookVolume::seq))
                        .map(volume -> findBestAladinItem(volume, searchCache))
                        .filter(Objects::nonNull)
                        .findFirst()
                        .orElse(null));
    }

    private AladinItem findBestAladinItem(BookVolume volume, Map<String, List<AladinItem>> searchCache) {
        List<AladinItem> byName = searchByQuery(volume.name(), searchCache);
        AladinItem isbnMatch = findByIsbn(byName, volume.isbn13());
        if (isbnMatch != null) {
            return isbnMatch;
        }
        AladinItem usefulNameMatch = findFirstUsefulItem(byName);
        if (usefulNameMatch != null || isBlank(volume.isbn13())) {
            return usefulNameMatch;
        }
        List<AladinItem> byIsbn = searchByQuery(volume.isbn13(), searchCache);
        return firstNonNull(findByIsbn(byIsbn, volume.isbn13()), findFirstUsefulItem(byIsbn));
    }

    private List<AladinItem> searchByQuery(String query, Map<String, List<AladinItem>> searchCache) {
        String normalizedQuery = Texts.trimToNull(query);
        if (normalizedQuery == null) {
            return List.of();
        }
        return searchCache.computeIfAbsent(normalizedQuery, key -> {
            var result = aladinSearchService.searchBookItems(key, 1);
            return result == null || result.items() == null ? List.of() : result.items();
        });
    }

    private AladinItem findByIsbn(List<AladinItem> items, String isbn13) {
        String normalizedIsbn = Texts.trimToNull(isbn13);
        if (normalizedIsbn == null) {
            return null;
        }
        return items.stream()
                .filter(item -> normalizedIsbn.equals(Texts.trimToNull(item.isbn13())) || normalizedIsbn.equals(Texts.trimToNull(item.isbn())))
                .findFirst()
                .orElse(null);
    }

    private AladinItem findFirstUsefulItem(List<AladinItem> items) {
        return items.stream()
                .filter(item -> !isBlank(item.author()) || !isBlank(item.description()))
                .findFirst()
                .orElse(null);
    }

    private boolean needsVolumeInfo(BookVolume volume) {
        return volume != null && isBlank(volume.description());
    }

    private static String firstNonBlank(String current, String candidate) {
        String normalizedCurrent = Texts.trimToNull(current);
        return normalizedCurrent != null ? normalizedCurrent : Texts.trimToNull(candidate);
    }

    private static <T> T firstNonNull(T first, T second) {
        return first != null ? first : second;
    }

    private static boolean isBlank(String value) {
        return Texts.trimToNull(value) == null;
    }

    private record BookInfoPatch(String author, String description) {
        static BookInfoPatch empty() {
            return new BookInfoPatch(null, null);
        }

        boolean hasChanges() {
            return author != null || description != null;
        }
    }
}
