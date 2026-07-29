package com.example.bookshelf.integration.aladin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class AladinUsedStockServiceTest {

    private static final String ISBN13 = "9781234567890";

    @Test
    void usesApiMinimumPriceWithoutFetchingBranchHtml() throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        AladinClient aladinClient = mock(AladinClient.class);
        AladinDropshippingResponse dropshippingResponse = objectMapper.readValue("""
                {
                  "item": [{
                    "title": "테스트 책",
                    "subInfo": {
                      "usedList": {
                        "spaceUsed": {
                          "itemCount": 2,
                          "minPrice": 2500,
                          "link": "https://example.com/branches"
                        }
                      }
                    }
                  }]
                }
                """, AladinDropshippingResponse.class);
        AladinUsedInfoResponse usedInfoResponse = objectMapper.readValue("""
                {
                  "itemOffStoreList": [
                    {
                      "offCode": "B1",
                      "offName": "강남점",
                      "link": "https://example.com/gangnam?foo=1&amp;bar=2"
                    },
                    {
                      "offCode": "B2",
                      "offName": "종로점",
                      "link": "https://example.com/jongno"
                    }
                  ]
                }
                """, AladinUsedInfoResponse.class);
        when(aladinClient.getDropshippingUsedBook(ISBN13)).thenReturn(dropshippingResponse);
        when(aladinClient.getUsedBookInfo(ISBN13)).thenReturn(usedInfoResponse);
        AladinUsedStockService service = new AladinUsedStockService(aladinClient, objectMapper);

        AladinUsedStockService.StockLookupResult result = service.lookupUsedStocksByIsbn13(ISBN13);

        assertThat(result.successful()).isTrue();
        assertThat(result.stocks()).extracting(AladinBranchStock::branch)
                .containsExactly("B1", "B2");
        assertThat(result.stocks()).extracting(AladinBranchStock::price)
                .containsOnly("2500");
        assertThat(result.stocks()).extracting(AladinBranchStock::grade)
                .containsOnlyNulls();
        assertThat(result.stocks()).extracting(AladinBranchStock::purchaseLink)
                .containsExactly(
                        "https://example.com/gangnam?foo=1&bar=2",
                        "https://example.com/jongno"
                );
        verify(aladinClient).getDropshippingUsedBook(ISBN13);
        verify(aladinClient).getUsedBookInfo(ISBN13);
        verifyNoMoreInteractions(aladinClient);
    }
}
