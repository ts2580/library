package com.example.bookshelf.integration.aladin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URI;

@Component
public class AladinClient {

    private static final Logger log = LoggerFactory.getLogger(AladinClient.class);

    private final AladinUrlBuilder urlBuilder;
    private final RestClient restClient;

    public AladinClient(AladinUrlBuilder urlBuilder, RestClient.Builder restClientBuilder) {
        this.urlBuilder = urlBuilder;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(3_000);
        requestFactory.setReadTimeout(8_000);
        this.restClient = restClientBuilder.requestFactory(requestFactory).build();
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #query + ':' + #page + ':' + #pageSize")
    public AladinSearchResponse getBookInfo(String query, int page, int pageSize) {
        return getBookInfo(AladinSearchOptions.simple(query, page, pageSize));
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #options")
    public AladinSearchResponse getBookInfo(AladinSearchOptions options) {
        if (!isApiConfigured()) {
            return null;
        }
        return callForObject(urlBuilder.bookSearchUrl(options), AladinSearchResponse.class);
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #isbn13")
    public AladinDropshippingResponse getDropshippingUsedBook(String isbn13) {
        if (!isApiConfigured()) {
            return null;
        }
        return callForObject(urlBuilder.dropshippingUsedBookUrl(isbn13), AladinDropshippingResponse.class);
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #isbn13")
    public AladinUsedInfoResponse getUsedBookInfo(String isbn13) {
        if (!isApiConfigured()) {
            return null;
        }
        return callForObject(urlBuilder.usedBookInfoUrl(isbn13), AladinUsedInfoResponse.class);
    }

    public String callRaw(String url) {
        try {
            return restClient.get()
                    .uri(URI.create(url))
                    .retrieve()
                    .body(String.class);
        } catch (RestClientException e) {
            log.debug("Raw call failed for url={}", maskSensitiveQueryParams(url), e);
            return null;
        }
    }

    private <T> T callForObject(String url, Class<T> responseType) {
        try {
            return restClient.get()
                    .uri(URI.create(url))
                    .retrieve()
                    .body(responseType);
        } catch (RestClientException e) {
            log.warn("Aladin API call failed for url={}", maskSensitiveQueryParams(url), e);
            return null;
        }
    }

    public boolean isApiConfigured() {
        if (urlBuilder.isConfigured()) {
            return true;
        }
        log.warn("Aladin API key is not configured. Set ALADIN_TTB_KEY to enable external search and stock refresh.");
        return false;
    }

    private String maskSensitiveQueryParams(String url) {
        if (url == null) {
            return null;
        }
        return url.replaceAll("(?i)(ttbkey=)[^&]*", "$1****");
    }
}
