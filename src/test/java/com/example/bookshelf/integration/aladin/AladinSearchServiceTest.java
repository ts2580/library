package com.example.bookshelf.integration.aladin;

import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AladinSearchServiceTest {

    @Mock
    private AladinClient aladinClient;

    @Mock
    private BookVolumeRepository bookVolumeRepository;

    private AladinSearchService service;

    @BeforeEach
    void setUp() {
        service = new AladinSearchService(aladinClient, new ObjectMapper(), bookVolumeRepository);
    }

    @Test
    void searchBookItems_reversesApiOrderBeforeReturn() {
        when(aladinClient.getBookInfo("해리포터", 1, 20)).thenReturn(new AladinSearchResponse(
                2,
                List.of(
                        new AladinItem("1권", "Author", null, "978111", null, "1000", "2000", null, null, "item-1", null),
                        new AladinItem("2권", "Author", null, "978222", null, "1500", "2500", null, null, "item-2", null)
                )
        ));

        var result = service.searchBookItems("해리포터", 1);

        assertThat(result.items()).hasSize(2);
        assertThat(result.items().get(0).isbn13()).isEqualTo("978222");
        assertThat(result.items().get(1).isbn13()).isEqualTo("978111");
    }

    @Test
    void searchBookView_convertsCoverAndFormatsPrice_withExistsAndOrder() {
        when(bookVolumeRepository.existsVolumeByIsbn13("978222")).thenReturn(true);
        when(aladinClient.getBookInfo(any(AladinSearchOptions.class))).thenReturn(new AladinSearchResponse(
                2,
                List.of(
                        new AladinItem(
                                "책1",
                                "저자",
                                "https://image.aladin.co.kr/product/35919/20/cover200/k862037699_1.jpg",
                                "978111",
                                null,
                                "10000",
                                "12000",
                                "2026-01-01",
                                "설명",
                                "item-1",
                                ""
                        ),
                        new AladinItem(
                                "책2",
                                "저자",
                                "https://example.com/cover.jpg",
                                "978222",
                                null,
                                "",
                                "20000",
                                "2026-01-02",
                                "설명",
                                "item-2",
                                ""
                        )
                )
        ));

        var view = service.searchBookView("해리포터");

        assertThat(view.hasError()).isFalse();
        assertThat(view.message()).isNull();
        assertThat(view.items()).hasSize(2);
        assertThat(view.items().get(0).cover())
                .isEqualTo("https://example.com/cover.jpg");
        assertThat(view.items().get(0).priceSales()).isEqualTo("-");
        assertThat(view.items().get(0).priceStandard()).isEqualTo("20,000");
        assertThat(view.items().get(0).exists()).isTrue();
        assertThat(view.items().get(1).cover())
                .isEqualTo("https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg");
        assertThat(view.items().get(1).priceSales()).isEqualTo("10,000");
        assertThat(view.items().get(1).priceStandard()).isEqualTo("12,000");
        assertThat(view.items().get(1).exists()).isFalse();
    }
}
