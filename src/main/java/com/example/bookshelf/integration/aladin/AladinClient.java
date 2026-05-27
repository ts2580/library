package com.example.bookshelf.integration.aladin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class AladinClient {

    private static final Logger log = LoggerFactory.getLogger(AladinClient.class);

    private final AladinUrlBuilder urlBuilder;
    private final RestClient restClient;

    public AladinClient(AladinUrlBuilder urlBuilder, RestClient.Builder restClientBuilder) {
        this.urlBuilder = urlBuilder;
        this.restClient = restClientBuilder.build();
    }

    @Cacheable("aladinApiCache")
    public AladinSearchResponse getBookInfo(String query, int page, int pageSize) {
        return callForObject(urlBuilder.bookSearchUrl(query, page, pageSize), AladinSearchResponse.class);
    }

    @Cacheable("aladinApiCache")
    public AladinDropshippingResponse getDropshippingUsedBook(String isbn13) {
        return callForObject(urlBuilder.dropshippingUsedBookUrl(isbn13), AladinDropshippingResponse.class);
    }

    @Cacheable("aladinApiCache")
    public AladinUsedInfoResponse getUsedBookInfo(String isbn13) {
        return callForObject(urlBuilder.usedBookInfoUrl(isbn13), AladinUsedInfoResponse.class);
    }

    public String callRaw(String url) {
        try {
            return restClient.get()
                    .uri(url)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientException e) {
            log.debug("Raw call failed for url={}", url, e);
            return null;
        }
    }

    private <T> T callForObject(String url, Class<T> responseType) {
        try {
            return restClient.get()
                    .uri(url)
                    .retrieve()
                    .body(responseType);
        } catch (RestClientException e) {
            log.warn("Aladin API call failed for url={}", url, e);
            return null;
        }
    }
}
