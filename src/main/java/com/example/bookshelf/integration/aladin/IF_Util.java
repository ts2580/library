package com.example.bookshelf.integration.aladin;

import org.springframework.stereotype.Component;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.StringJoiner;

@Component
public class IF_Util {

    private static final String TTB_KEY = "ttbtrstyq0151001";

    public String getBookInfoURL(String searchWord) {
        return getBookInfoURL(searchWord, 1, 20);
    }

    public String getBookInfoURL(String searchWord, int page, int pageSize) {
        int size = pageSize > 0 ? pageSize : 20;
        int p = Math.max(page, 1);
        int start = ((p - 1) * size) + 1;

        String baseUrl = "http://www.aladin.co.kr/ttb/api/ItemSearch.aspx?";
        Map<String, String> params = new LinkedHashMap<>();
        params.put("ttbkey", TTB_KEY);
        params.put("Query", searchWord);
        params.put("Sort", "PublishTime");
        params.put("QueryType", "Title");
        params.put("MaxResults", String.valueOf(size));
        params.put("start", String.valueOf(start));
        params.put("Cover", "Big");
        params.put("SearchTarget", "Book");
        params.put("output", "JS");
        params.put("Version", "20131101");

        return toQueryUrl(baseUrl, params);
    }

    public String getDropshippingUsedBookURL(String isbn13) {
        String baseUrl = "http://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?";
        Map<String, String> params = new LinkedHashMap<>();
        params.put("ttbkey", TTB_KEY);
        params.put("ItemId", isbn13);
        params.put("itemIdType", "ISBN13");
        params.put("OptResult", "usedList");
        params.put("output", "JS");
        params.put("Version", "20131101");

        return toQueryUrl(baseUrl, params);
    }

    public String getUsedBookInfoURL(String isbn13) {
        String baseUrl = "http://www.aladin.co.kr/ttb/api/ItemOffStoreList.aspx?";
        Map<String, String> params = new LinkedHashMap<>();
        params.put("ttbkey", TTB_KEY);
        params.put("ItemId", isbn13);
        params.put("itemIdType", "ISBN13");
        params.put("output", "JS");
        params.put("Version", "20131101");

        return toQueryUrl(baseUrl, params);
    }

    private String toQueryUrl(String baseUrl, Map<String, String> params) {
        StringJoiner joiner = new StringJoiner("&");
        for (Map.Entry<String, String> e : params.entrySet()) {
            joiner.add(e.getKey() + '=' + encode(e.getValue()));
        }
        return baseUrl + joiner;
    }

    private String encode(String text) {
        try {
            return URLEncoder.encode(text == null ? "" : text, StandardCharsets.UTF_8.toString());
        } catch (UnsupportedEncodingException e) {
            return text == null ? "" : text;
        }
    }
}
