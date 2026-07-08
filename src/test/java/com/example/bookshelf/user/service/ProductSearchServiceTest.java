package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinItem;
import com.example.bookshelf.integration.aladin.AladinSearchResult;
import com.example.bookshelf.integration.aladin.AladinSearchService;
import com.example.bookshelf.integration.aladin.AladinSearchViewItem;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProductSearchServiceTest {

    @Mock private BookDataRepository bookDataRepository;
    @Mock private BookVolumeRepository bookVolumeRepository;
    @Mock private AladinSearchService aladinSearchService;

    @Test
    void search_convertsAladinCover200ToCover500() {
        ProductSearchService service = new ProductSearchService(
                bookDataRepository,
                bookVolumeRepository,
                aladinSearchService
        );

        when(bookDataRepository.findAllBookTypes()).thenReturn(List.of("만화"));
        when(bookVolumeRepository.countAllBookVolumes()).thenReturn(0);
        when(bookVolumeRepository.findAllVolumes("id", 20, 0)).thenReturn(List.of());
        when(aladinSearchService.searchBookItems("해리포터", 1))
                .thenReturn(new AladinSearchResult(
                        List.of(new AladinItem(
                                "해리 포터 1권",
                                "해리포터",
                                "https://image.aladin.co.kr/product/35919/20/cover200/k862037699_1.jpg",
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
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);

        var viewModel = service.search(new ProductSearchService.ProductSearchRequest(
                null,
                "해리포터",
                1,
                1,
                "id",
                null
        ));

        List<AladinSearchViewItem> results = viewModel.aladinResults();
        assertThat(results).hasSize(1);
        assertThat(results.get(0).cover())
                .isEqualTo("https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg");
    }
}
