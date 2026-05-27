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

    private static final String API_BASE_URL = "http://www.aladin.co.kr/ttb/api/";
    private static final String API_VERSION = "20131101";
    private static final int DEFAULT_PAGE_SIZE = 20;

    private final String ttbKey;

    public AladinUrlBuilder(@Value("${aladin.ttb-key:ttbtrstyq0151001}") String ttbKey) {
        this.ttbKey = ttbKey;
    }

    public String bookSearchUrl(String searchWord, int page, int pageSize) {
        int size = pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
        int start = ((Math.max(page, 1) - 1) * size) + 1;

        Map<String, String> params = defaultParams();
        params.put("Query", searchWord);
        params.put("Sort", "PublishTime");
        params.put("QueryType", "Title");
        params.put("MaxResults", String.valueOf(size));
        params.put("start", String.valueOf(start));
        params.put("Cover", "Big");
        params.put("SearchTarget", "Book");
        return queryUrl("ItemSearch.aspx", params);
    }

    public String dropshippingUsedBookUrl(String isbn13) {
        Map<String, String> params = defaultParams();
        params.put("ItemId", isbn13);
        params.put("itemIdType", "ISBN13");
        params.put("OptResult", "usedList");
        return queryUrl("ItemLookUp.aspx", params);
    }

    public String usedBookInfoUrl(String isbn13) {
        Map<String, String> params = defaultParams();
        params.put("ItemId", isbn13);
        params.put("itemIdType", "ISBN13");
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
