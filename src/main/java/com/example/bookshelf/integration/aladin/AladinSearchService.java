package com.example.bookshelf.integration.aladin;

import com.example.bookshelf.common.Texts;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Collections;

@Service
public class AladinSearchService {

    private static final Logger log = LoggerFactory.getLogger(AladinSearchService.class);
    private static final int PAGE_SIZE = 20;

    private final AladinClient aladinClient;
    private final ObjectMapper objectMapper;

    public AladinSearchService(AladinClient aladinClient, ObjectMapper objectMapper) {
        this.aladinClient = aladinClient;
        this.objectMapper = objectMapper;
    }

    public AladinSearchResult searchBookItems(String query, int page) {
        int currentPage = Math.max(page, 1);
        String normalizedQuery = Texts.trimToEmpty(query);
        AladinSearchResponse response = aladinClient.getBookInfo(normalizedQuery, currentPage, PAGE_SIZE);

        if (response == null) {
            log.warn("[aladin] API response is null for query='{}'", normalizedQuery);
            return new AladinSearchResult(Collections.emptyList(), 0, currentPage, PAGE_SIZE);
        }

        int totalResults = response.totalResults() != null ? response.totalResults() : 0;
        java.util.List<AladinItem> items = response.item() != null ? response.item() : Collections.emptyList();

        log.info("[aladin] parsed query='{}' totalResults={}, items.size={}", normalizedQuery, totalResults, items.size());
        return new AladinSearchResult(items, totalResults, currentPage, PAGE_SIZE);
    }

    public AladinSearchView searchBookView(String query) {
        String normalizedQuery = Texts.trimToEmpty(query);
        AladinSearchResponse response = aladinClient.getBookInfo(normalizedQuery, 1, PAGE_SIZE);

        String json = serializeToJson(response);

        if (response == null) {
            return new AladinSearchView(normalizedQuery, 0, Collections.emptyList(), json, true, "알라딘 검색 응답을 가져오지 못했습니다.");
        }

        int totalResults = response.totalResults() != null ? response.totalResults() : 0;
        java.util.List<AladinItem> items = response.item() != null ? response.item() : Collections.emptyList();

        String message = items.isEmpty() ? "검색 결과가 없습니다." : null;
        return new AladinSearchView(normalizedQuery, totalResults, items, json, false, message);
    }

    private String serializeToJson(Object obj) {
        if (obj == null) return "{}";
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize DTO to JSON", e);
            return "{\"error\": \"serialization_failed\"}";
        }
    }
}
