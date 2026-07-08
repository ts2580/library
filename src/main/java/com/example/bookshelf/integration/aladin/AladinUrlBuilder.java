package com.example.bookshelf.integration.aladin;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.StringJoiner;

@Component
public class AladinUrlBuilder {

    private static final String API_BASE_URL = "https://www.aladin.co.kr/ttb/api/";
    private static final String API_VERSION = "20131101";
    private static final int DEFAULT_PAGE_SIZE = 20;

    private final String ttbKey;

    public AladinUrlBuilder(@Value("${aladin.ttb-key:}") String ttbKey) {
        this.ttbKey = ttbKey == null ? "" : ttbKey.trim();
    }

    public boolean isConfigured() {
        return !ttbKey.isBlank();
    }

    public String bookSearchUrl(String searchWord, int page, int pageSize) {
        return bookSearchUrl(AladinSearchOptions.simple(searchWord, page, pageSize));
    }

    public String bookSearchUrl(AladinSearchOptions options) {
        Map<String, String> params = defaultParams();
        params.put("Query", options.query());
        params.put("Sort", options.sort());
        params.put("QueryType", options.queryType());
        params.put("MaxResults", String.valueOf(options.maxResults()));
        params.put("start", String.valueOf(options.start()));
        params.put("Cover", options.cover());
        params.put("SearchTarget", options.searchTarget());
        if (options.categoryId() != null) {
            params.put("CategoryId", String.valueOf(options.categoryId()));
        }
        if (options.recentPublishFilter() > 0) {
            params.put("RecentPublishFilter", String.valueOf(options.recentPublishFilter()));
        }
        if (options.outOfStockFilter()) {
            params.put("outofStockfilter", "1");
        }
        return queryUrl("ItemSearch.aspx", params);
    }

    public String dropshippingUsedBookUrl(String isbn13) {
        Map<String, String> params = defaultParams();
        params.put("ItemId", isbn13);
        params.put("itemIdType", "ISBN13");
        params.put("Cover", "Big");
        params.put("OptResult", "usedList");
        return queryUrl("ItemLookUp.aspx", params);
    }

    public String usedBookInfoUrl(String isbn13) {
        Map<String, String> params = defaultParams();
        params.put("ItemId", isbn13);
        params.put("itemIdType", "ISBN13");
        params.put("Cover", "Big");
        return queryUrl("ItemOffStoreList.aspx", params);
    }

    private Map<String, String> defaultParams() {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("ttbkey", ttbKey);
        params.put("output", "JS");
        params.put("Version", API_VERSION);
        return params;
    }

    private String queryUrl(String endpoint, Map<String, String> params) {
        StringJoiner joiner = new StringJoiner("&");
        for (Map.Entry<String, String> entry : params.entrySet()) {
            joiner.add(entry.getKey() + '=' + encode(entry.getValue()));
        }
        return API_BASE_URL + endpoint + '?' + joiner;
    }

    private String encode(String text) {
        return URLEncoder.encode(text == null ? "" : text, StandardCharsets.UTF_8);
    }
}
