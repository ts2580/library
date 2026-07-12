package com.example.bookshelf.web;

import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.service.BookCatalogService;
import com.example.bookshelf.user.service.ProductService;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.servlet.mvc.support.RedirectAttributesModelMap;

import com.example.bookshelf.integration.aladin.AladinItem;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BookshelfControllerTest {

    @Mock private BookCatalogService bookCatalogService;
    @Mock private BookDataRepository bookDataRepository;
    @Mock private BookVolumeRepository bookVolumeRepository;
    @Mock private com.example.bookshelf.integration.aladin.AladinSearchService aladinSearchService;
    @Mock private ProductService productService;

    @Test
    void createBook_insertsManualBookAndRedirectsToDetail() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.insertBook("수동 책", "저자", "설명", "cover", "만화", "12")).thenReturn(42);
        when(aladinSearchService.searchBookItems("수동 책", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(java.util.Collections.emptyList(), 0, 1, 20));

        String view = controller.createBook("수동 책", "저자", "설명", "cover", "만화", "12", null, null, null, false, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/42");
        assertThat(redirectAttributes.getFlashAttributes().get("success")).isEqualTo("책을 추가했습니다.");
        verify(bookDataRepository).insertBook("수동 책", "저자", "설명", "cover", "만화", "12");
    }

    @Test
    void createBook_rejectsBlankTitle() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.createBook(" ", null, null, null, null, null, null, null, null, false, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books");
        assertThat(redirectAttributes.getFlashAttributes().get("error")).isEqualTo("책 제목을 입력해 주세요.");
        verify(bookDataRepository, never()).insertBook(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void createBook_convertsAladinCover200ToCover500BeforeInsert() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String cover200 = "https://image.aladin.co.kr/product/35919/20/cover200/k862037699_1.jpg";
        String cover500 = "https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg";

        when(aladinSearchService.searchBookItems("테스트 책", 1))
                .thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                        java.util.List.of(new AladinItem(
                                "테스트 책 1권",
                                "저자",
                                cover200,
                                "9781234567890",
                                null,
                                "10000",
                                "12000",
                                "2026-01-01",
                                "설명",
                                "item-1",
                                ""
                        )),
                        1,
                        1,
                        20
                ));
        when(productService.persistCoverImage(cover500, "9781234567890_book_42")).thenReturn(cover500);
        when(productService.persistCoverImage(cover500, "9781234567890")).thenReturn(cover500);
        when(bookDataRepository.insertBook("테스트 책", "저자", "설명", cover500, null, null)).thenReturn(42);
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);

        String view = controller.createBook("테스트 책", null, null, null, null, null, null, null, null, false, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/42");
        assertThat(redirectAttributes.getFlashAttributes().get("success")).isEqualTo("책을 추가했습니다.");
        verify(bookDataRepository).insertBook("테스트 책", "저자", "설명", cover500, null, null);
        verify(bookVolumeRepository).insertVolume(42, 1, "9781234567890", "테스트 책 1권", cover500, "10000", "설명");
    }

    @Test
    void previewBookCreate_marksOwnedItemsAndNormalizesCovers() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        String cover200 = "https://image.aladin.co.kr/product/35919/20/cover200/k862037699_1.jpg";
        String cover500 = "https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg";
        when(aladinSearchService.searchBookItems("테스트 책", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(new AladinItem("테스트 책 1권", "저자", cover200, "9781234567890", null, "10000", "12000", "2026-01-01", "설명", "item-1", "")),
                1,
                1,
                20
        ));
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(true);

        var response = controller.previewBookCreate("테스트 책");

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().items()).containsExactly(new BookshelfController.BookCreatePreviewItem(
                "테스트 책 1권", "저자", cover500, "9781234567890", null,
                "10000", "12000", "9781234567890", true, false
        ));
    }

    @Test
    void createBook_insertsOnlySelectedAladinItems() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        AladinItem first = new AladinItem("시리즈 1권", "저자 1", "cover-1", "9781111111111", null, "10000", "12000", "2026-01-01", "설명 1", "item-1", "");
        AladinItem second = new AladinItem("시리즈 2권", "저자 2", "cover-2", "9782222222222", null, "11000", "13000", "2026-01-02", "설명 2", "item-2", "");
        when(aladinSearchService.searchBookItems("시리즈", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(first, second), 2, 1, 20));
        when(bookVolumeRepository.existsVolumeByIsbn13("9782222222222")).thenReturn(false);
        when(bookDataRepository.insertBook("시리즈", "저자 2", "설명 2", "cover-2", "만화", null)).thenReturn(42);

        String view = controller.createBook(
                "시리즈", null, null, null, "만화", null,
                null, java.util.List.of("9782222222222"), null, true, redirectAttributes
        );

        assertThat(view).isEqualTo("redirect:/books/42");
        verify(bookVolumeRepository, never()).existsVolumeByIsbn13("9781111111111");
        verify(bookVolumeRepository).insertVolume(42, 1, "9782222222222", "시리즈 2권", "cover-2", "11000", "설명 2");
    }

    @Test
    void createBook_rejectsConfirmedPreviewWithoutSelection() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(aladinSearchService.searchBookItems("시리즈", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(new AladinItem("시리즈 1권", "저자", "cover", "9781111111111", null, "10000", "12000", "2026-01-01", "설명", "item-1", "")),
                1, 1, 20));

        String view = controller.createBook(
                "시리즈", null, null, null, "만화", null,
                null, java.util.List.of(), null, true, redirectAttributes
        );

        assertThat(view).isEqualTo("redirect:/books");
        assertThat(redirectAttributes.getFlashAttributes().get("error")).isEqualTo("추가할 알라딘 항목을 하나 이상 선택해 주세요.");
        verify(bookDataRepository, never()).insertBook(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void createBook_appendsToExistingBookFromNextRecordedVolumeAndKeepsCategory() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        Book targetBook = new Book(7, "기존 시리즈", "기존 저자", "기존 설명", "4", "만화", "book-cover", null, null);
        AladinItem fifth = new AladinItem("기존 시리즈 5권", "저자", "cover-5", "9785555555555", null, "10000", "12000", "2026-01-01", "설명 5", "item-5", "");
        AladinItem sixth = new AladinItem("기존 시리즈 6권", "저자", "cover-6", "9786666666666", null, "11000", "13000", "2026-01-02", "설명 6", "item-6", "");
        when(bookDataRepository.findBookById(7)).thenReturn(targetBook);
        when(aladinSearchService.searchBookItems("기존 시리즈", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(fifth, sixth), 2, 1, 20));
        when(bookVolumeRepository.existsVolumeByIsbn13("9785555555555")).thenReturn(false);
        when(bookVolumeRepository.existsVolumeByIsbn13("9786666666666")).thenReturn(false);
        when(bookVolumeRepository.nextVolumeSeq(7)).thenReturn(5);
        when(bookVolumeRepository.findVolumesByBookId(7)).thenReturn(java.util.Collections.nCopies(6, null));

        String view = controller.createBook(
                "기존 시리즈", null, null, null, "소설", null,
                7, java.util.List.of("9785555555555", "9786666666666"), null, true, redirectAttributes
        );

        assertThat(view).isEqualTo("redirect:/books/7");
        assertThat(redirectAttributes.getFlashAttributes().get("success")).isEqualTo("기존 책에 선택한 항목을 추가했습니다.");
        verify(bookVolumeRepository).insertVolume(7, 5, "9785555555555", "기존 시리즈 5권", "cover-5", "10000", "설명 5");
        verify(bookVolumeRepository).insertVolume(7, 6, "9786666666666", "기존 시리즈 6권", "cover-6", "11000", "설명 6");
        verify(bookDataRepository, never()).insertBook(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
        verify(bookDataRepository).updateBook(7, "기존 시리즈", "기존 저자", "기존 설명", "book-cover", "만화", "6");
    }

    @Test
    void createBook_appendsMixedSideStoryAndNumberedVolumesPerSelection() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        AladinItem sideStory = new AladinItem("기존 시리즈 외전", "저자", "side-cover", "9787777777777", null, "10000", "12000", "2026-01-01", "외전 설명", "item-side", "");
        AladinItem fifth = new AladinItem("기존 시리즈 5권", "저자", "cover-5", "9785555555555", null, "11000", "13000", "2026-01-02", "설명 5", "item-5", "");
        when(bookDataRepository.findBookById(7)).thenReturn(new Book(7, "기존 시리즈", "기존 저자", "기존 설명", "4", "만화", "book-cover", null, null));
        when(aladinSearchService.searchBookItems("기존 시리즈", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(sideStory, fifth), 2, 1, 20));
        when(bookVolumeRepository.existsVolumeByIsbn13("9787777777777")).thenReturn(false);
        when(bookVolumeRepository.existsVolumeByIsbn13("9785555555555")).thenReturn(false);
        when(bookVolumeRepository.nextVolumeSeq(7)).thenReturn(5);
        when(bookVolumeRepository.findVolumesByBookId(7)).thenReturn(java.util.Collections.nCopies(6, null));

        String view = controller.createBook(
                "기존 시리즈", null, null, null, "소설", null,
                7,
                java.util.List.of("9787777777777", "9785555555555"),
                java.util.List.of("9787777777777"),
                true,
                redirectAttributes
        );

        assertThat(view).isEqualTo("redirect:/books/7");
        verify(bookVolumeRepository).insertVolume(7, null, "9787777777777", "기존 시리즈 외전", "side-cover", "10000", "외전 설명");
        verify(bookVolumeRepository).insertVolume(7, 5, "9785555555555", "기존 시리즈 5권", "cover-5", "11000", "설명 5");
    }

    @Test
    void createBook_appendsSideStoryToExistingBookWithoutAllocatingVolumeNumber() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.findBookById(7)).thenReturn(new Book(7, "기존 시리즈", "기존 저자", "기존 설명", "4", "만화", "book-cover", null, null));
        when(aladinSearchService.searchBookItems("기존 시리즈 외전", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(new AladinItem("기존 시리즈 외전", "저자", "side-cover", "9787777777777", null, "10000", "12000", "2026-01-01", "외전 설명", "item-side", "")),
                1, 1, 20));
        when(bookVolumeRepository.existsVolumeByIsbn13("9787777777777")).thenReturn(false);
        when(bookVolumeRepository.findVolumesByBookId(7)).thenReturn(java.util.Collections.nCopies(5, null));

        String view = controller.createBook(
                "기존 시리즈 외전", null, null, null, "소설", null,
                7, java.util.List.of("9787777777777"), java.util.List.of("9787777777777"), true, redirectAttributes
        );

        assertThat(view).isEqualTo("redirect:/books/7");
        verify(bookVolumeRepository, never()).nextVolumeSeq(7);
        verify(bookVolumeRepository).insertVolume(7, null, "9787777777777", "기존 시리즈 외전", "side-cover", "10000", "외전 설명");
        verify(bookDataRepository).updateBook(7, "기존 시리즈", "기존 저자", "기존 설명", "book-cover", "만화", "5");
    }

    @Test
    void createBook_createsNewBookWithSideStoryWithoutVolumeNumber() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(aladinSearchService.searchBookItems("새 시리즈 외전", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(new AladinItem("새 시리즈 외전", "저자", "side-cover", "9788888888888", null, "10000", "12000", "2026-01-01", "외전 설명", "item-side", "")),
                1, 1, 20));
        when(bookVolumeRepository.existsVolumeByIsbn13("9788888888888")).thenReturn(false);
        when(bookDataRepository.insertBook("새 시리즈 외전", "저자", "외전 설명", "side-cover", "만화", null)).thenReturn(42);

        String view = controller.createBook(
                "새 시리즈 외전", null, null, null, "만화", null,
                null, java.util.List.of("9788888888888"), java.util.List.of("9788888888888"), true, redirectAttributes
        );

        assertThat(view).isEqualTo("redirect:/books/42");
        verify(bookVolumeRepository).insertVolume(42, null, "9788888888888", "새 시리즈 외전", "side-cover", "10000", "외전 설명");
    }

    @Test
    void migrateCovers_updatesOldCoversAndRedirectsToBookList() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(productService.migrateOldCovers()).thenReturn(5);

        String view = controller.migrateCovers(redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books");
        assertThat(redirectAttributes.getFlashAttributes().get("success")).isEqualTo("5개의 표지 이미지를 다운로드하여 업데이트했습니다.");
        verify(productService).migrateOldCovers();
    }

    @Test
    void updateBook_convertsAladinCover200ToCover500BeforePersist() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.findBookById(3)).thenReturn(new Book(3, "기존 책", "기존 저자", "기존 설명", "10", "소설", "old-cover", null, null));

        String cover200 = "https://image.aladin.co.kr/product/35919/20/cover200/k862037699_1.jpg";
        String cover500 = "https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg";
        when(productService.persistCoverImage(cover500, "9781111111111_book_3")).thenReturn(cover500);
        when(bookVolumeRepository.findVolumesByBookId(3)).thenReturn(java.util.List.of(
                new BookVolume(10, 1, 3, "9781111111111", "기존 책 1권", "cover-1", "10000", "설명", false, false, "1"),
                new BookVolume(11, 2, 3, "9782222222222", "기존 책 2권", "cover-2", "11000", "설명", false, false, "2")
        ));

        String view = controller.updateBook(3, "기존 책", "기존 저자", "기존 설명", cover200, "소설", "10", redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/3");
        verify(bookDataRepository).updateBook(3, "기존 책", "기존 저자", "기존 설명", cover500, "소설", "2");
    }

    @Test
    void updateVolume_convertsAladinCover200ToCover500BeforePersist() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.findBookById(3)).thenReturn(new Book(3, "기존 책", "기존 저자", "기존 설명", "10", "소설", "old-cover", null, null));

        String cover200 = "https://image.aladin.co.kr/product/35919/20/cover200/k862037699_1.jpg";
        String cover500 = "https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg";
        when(productService.persistCoverImage(cover500, "9781234567890")).thenReturn(cover500);

        String view = controller.updateVolume(3, 7, "9781234567890", "책1", cover200, "10000", "설명", false, true, false, 1, null, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/3");
        verify(bookVolumeRepository).updateVolume(3, 7, "9781234567890", "책1", cover500, "10000", "설명", false, true, 1);
    }

    @Test
    void updateVolume_sideStoryIgnoresSubmittedSequence() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.findBookById(3)).thenReturn(new Book(3, "기존 책", "기존 저자", "기존 설명", "10", "소설", "old-cover", null, null));

        String view = controller.updateVolume(3, 7, "9781234567890", "외전", "cover", "10000", "설명", false, false, true, 99, null, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/3");
        verify(bookVolumeRepository).updateVolume(3, 7, "9781234567890", "외전", "cover", "10000", "설명", false, false, null);
    }

    @Test
    void updateVolume_numberedVolumeRequiresPositiveSequence() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.findBookById(3)).thenReturn(new Book(3, "기존 책", "기존 저자", "기존 설명", "10", "소설", "old-cover", null, null));

        String view = controller.updateVolume(3, 7, "9781234567890", "일반 권", "cover", "10000", "설명", false, false, false, null, null, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/3");
        assertThat(redirectAttributes.getFlashAttributes().get("error")).isEqualTo("권 번호를 1 이상 입력하거나 외전을 선택해 주세요.");
        verify(bookVolumeRepository, never()).updateVolume(
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void enrichBookInfo_fillsMissingBookInfoFromFirstVolumeAndMissingVolumeDescriptions() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        Book book = new Book(3, "시리즈", null, null, "2", "만화", "cover", null, null);
        BookVolume firstVolume = new BookVolume(10, 1, 3, "9781111111111", "시리즈 1권", "cover-1", "10000", null, false, false, "1");
        BookVolume secondVolume = new BookVolume(11, 2, 3, "9782222222222", "시리즈 2권", "cover-2", "11000", null, true, false, "2");
        when(bookDataRepository.findBookById(3)).thenReturn(book);
        when(bookVolumeRepository.findVolumesByBookId(3)).thenReturn(java.util.List.of(firstVolume, secondVolume));
        when(aladinSearchService.searchBookItems("시리즈 1권", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(new AladinItem("시리즈 1권", "대표 저자", "cover", "9781111111111", null, "10000", "12000", "2026-01-01", "1권 설명", "item-1", "")),
                1,
                1,
                20
        ));
        when(aladinSearchService.searchBookItems("시리즈 2권", 1)).thenReturn(new com.example.bookshelf.integration.aladin.AladinSearchResult(
                java.util.List.of(new AladinItem("시리즈 2권", "대표 저자", "cover", "9782222222222", null, "11000", "13000", "2026-01-02", "2권 설명", "item-2", "")),
                1,
                1,
                20
        ));

        String view = controller.enrichBookInfo(3, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/3");
        assertThat(redirectAttributes.getFlashAttributes().get("success")).isEqualTo("정보 보강 완료: 책 1건, 권 2건");
        verify(bookVolumeRepository).updateVolume(3, 10, "9781111111111", "시리즈 1권", "cover-1", "10000", "1권 설명", false, false, 1);
        verify(bookVolumeRepository).updateVolume(3, 11, "9782222222222", "시리즈 2권", "cover-2", "11000", "2권 설명", true, false, 2);
        verify(bookDataRepository).updateBook(3, "시리즈", "대표 저자", "1권 설명", "cover", "만화", "2");
    }

    @Test
    void enrichBookInfo_skipsAladinLookupWhenNoAuthorOrDescriptionIsMissing() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository, aladinSearchService, productService);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.findBookById(3)).thenReturn(new Book(3, "완성 책", "저자", "설명", "1", "소설", "cover", null, null));
        when(bookVolumeRepository.findVolumesByBookId(3)).thenReturn(java.util.List.of(
                new BookVolume(10, 1, 3, "9781111111111", "완성 책 1권", "cover-1", "10000", "권 설명", false, false, "1")
        ));

        String view = controller.enrichBookInfo(3, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/3");
        assertThat(redirectAttributes.getFlashAttributes().get("success")).isEqualTo("채울 저자/설명이 없습니다.");
        verifyNoInteractions(aladinSearchService);
    }
}
