package com.example.bookshelf.integration.aladin;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AladinUrlBuilderTest {

    @Test
    void bookSearchUrlUsesTitleSearchAndAladinPageNumber() {
        AladinUrlBuilder builder = new AladinUrlBuilder("test-key");

        String url = builder.bookSearchUrl("르기아스", 2, 20);

        assertThat(url)
                .contains("Query=%EB%A5%B4%EA%B8%B0%EC%95%84%EC%8A%A4")
                .contains("QueryType=Title")
                .contains("MaxResults=20")
                .contains("start=2")
                .doesNotContain("start=21");
    }

    @Test
    void bookSearchUrlIncludesDetailedSearchOptions() {
        AladinUrlBuilder builder = new AladinUrlBuilder("test-key");

        String url = builder.bookSearchUrl(AladinSearchOptions.of(
                "문학",
                "Author",
                "Book",
                "SalesPoint",
                "MidBig",
                30,
                3,
                1,
                12,
                true
        ));

        assertThat(url)
                .contains("Query=%EB%AC%B8%ED%95%99")
                .contains("QueryType=Author")
                .contains("SearchTarget=Book")
                .contains("Sort=SalesPoint")
                .contains("Cover=MidBig")
                .contains("MaxResults=30")
                .contains("start=3")
                .contains("CategoryId=1")
                .contains("RecentPublishFilter=12")
                .contains("outofStockfilter=1");
    }

    @Test
    void dropshippingUsedBookUrlUsesBigCoverAndIsbn13() {
        AladinUrlBuilder builder = new AladinUrlBuilder("test-key");

        String url = builder.dropshippingUsedBookUrl("9781234567890");

        assertThat(url)
                .contains("ItemId=9781234567890")
                .contains("itemIdType=ISBN13")
                .contains("Cover=Big")
                .contains("OptResult=usedList");
    }

    @Test
    void usedBookInfoUrlUsesBigCoverAndIsbn13() {
        AladinUrlBuilder builder = new AladinUrlBuilder("test-key");

        String url = builder.usedBookInfoUrl("9781234567890");

        assertThat(url)
                .contains("ItemId=9781234567890")
                .contains("itemIdType=ISBN13")
                .contains("Cover=Big");
    }
}
