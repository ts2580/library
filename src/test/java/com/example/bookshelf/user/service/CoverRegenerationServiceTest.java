package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinItem;
import com.example.bookshelf.integration.aladin.AladinSearchResult;
import com.example.bookshelf.integration.aladin.AladinSearchService;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CoverRegenerationServiceTest {

    @Mock private BookDataRepository bookDataRepository;
    @Mock private BookVolumeRepository bookVolumeRepository;
    @Mock private AladinSearchService aladinSearchService;
    @Mock private ProductService productService;

    @Test
    void regeneratePendingCovers_updatesOnlySuccessfulRecordsForOwner() {
        BookVolume volume = new BookVolume(
                20, 1, 10, "9781234567890", "시리즈 1권", null, "12000", null, false, false, "1"
        );
        Book book = new Book(10, "시리즈", "저자", null, "1", "만화", null, null, null);
        AladinItem item = new AladinItem(
                "시리즈 1권", "저자", "https://image.aladin.co.kr/product/1/cover500/test.jpg",
                "9781234567890", null, null, null, null, null, null, null
        );
        when(bookVolumeRepository.findVolumesPendingCoverGenerationForOwner(7)).thenReturn(List.of(volume));
        when(bookDataRepository.findBooksPendingCoverGenerationForOwner(7)).thenReturn(List.of(book));
        when(bookVolumeRepository.findVolumesByBookId(10)).thenReturn(List.of(volume));
        when(aladinSearchService.searchBookItems("9781234567890", 1))
                .thenReturn(new AladinSearchResult(List.of(item), 1, 1, 20));
        when(productService.persistCoverImage(item.cover(), "9781234567890"))
                .thenReturn("/covers/9781234567890.jpg");
        when(productService.persistCoverImage(item.cover(), "9781234567890_book_10"))
                .thenReturn("/covers/9781234567890_book_10.jpg");
        when(productService.isLocalCoverAvailable(org.mockito.ArgumentMatchers.any()))
                .thenAnswer(invocation -> invocation.getArgument(0) != null
                        && invocation.<String>getArgument(0).startsWith("/covers/"));

        var result = service().regeneratePendingCovers(7);

        assertThat(result.generatedVolumes()).isEqualTo(1);
        assertThat(result.generatedBooks()).isEqualTo(1);
        verify(bookVolumeRepository).updateGeneratedCoverForOwner(10, 20, 7, "/covers/9781234567890.jpg");
        verify(bookDataRepository).updateGeneratedCoverForOwner(10, 7, "/covers/9781234567890_book_10.jpg");
    }

    @Test
    void regeneratePendingCovers_leavesFailedRecordsPending() {
        BookVolume volume = new BookVolume(
                20, 1, 10, "9780000000000", "검색 실패", null, null, null, false, false, "1"
        );
        when(bookVolumeRepository.findVolumesPendingCoverGenerationForOwner(7)).thenReturn(List.of(volume));
        when(bookDataRepository.findBooksPendingCoverGenerationForOwner(7)).thenReturn(List.of());
        when(aladinSearchService.searchBookItems("9780000000000", 1))
                .thenReturn(new AladinSearchResult(List.of(), 0, 1, 20));

        var result = service().regeneratePendingCovers(7);

        assertThat(result.failedCount()).isEqualTo(1);
        verify(bookVolumeRepository, never()).updateGeneratedCoverForOwner(
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    private CoverRegenerationService service() {
        return new CoverRegenerationService(
                bookDataRepository, bookVolumeRepository, aladinSearchService, productService
        );
    }
}
