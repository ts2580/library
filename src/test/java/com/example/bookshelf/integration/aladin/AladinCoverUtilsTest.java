package com.example.bookshelf.integration.aladin;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AladinCoverUtilsTest {

    @Test
    void toCover500_convertsAladinCoverSize() {
        String original = "https://image.aladin.co.kr/product/35919/20/cover200/k862037699_1.jpg";
        String expected = "https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg";

        assertThat(AladinCoverUtils.toCover500(original)).isEqualTo(expected);
    }

    @Test
    void toCover500_keepsOtherHostsAndAlreadySizedCovers() {
        assertThat(AladinCoverUtils.toCover500("https://example.com/cover200/image.jpg"))
                .isEqualTo("https://example.com/cover200/image.jpg");

        String alreadyHigh = "https://image.aladin.co.kr/product/35919/20/cover500/k862037699_1.jpg";
        assertThat(AladinCoverUtils.toCover500(alreadyHigh)).isEqualTo(alreadyHigh);
    }
}
