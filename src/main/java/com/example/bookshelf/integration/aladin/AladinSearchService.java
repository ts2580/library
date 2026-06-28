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
    private final com.example.bookshelf.user.repository.BookVolumeRepository bookVolumeRepository;

    public AladinSearchService(AladinClient aladinClient, ObjectMapper objectMapper, com.example.bookshelf.user.repository.BookVolumeRepository bookVolumeRepository) {
        this.aladinClient = aladinClient;
        this.objectMapper = objectMapper;
        this.bookVolumeRepository = bookVolumeRepository;
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
        return searchBookView(AladinSearchOptions.simple(query, 1, PAGE_SIZE));
    }

    public AladinSearchView searchBookView(AladinSearchOptions options) {
        String normalizedQuery = Texts.trimToEmpty(options.query());
        AladinSearchResponse response = aladinClient.getBookInfo(options);

        String json = serializeToJson(response);

        if (response == null) {
            return new AladinSearchView(normalizedQuery, 0, Collections.emptyList(), json, true, "알라딘 검색 응답을 가져오지 못했습니다.");
        }

        int totalResults = response.totalResults() != null ? response.totalResults() : 0;
        java.util.List<AladinItem> items = response.item() != null ? response.item() : Collections.emptyList();
        
        java.util.List<AladinSearchViewItem> viewItems = items.stream().map(item -> new AladinSearchViewItem(
                item.title(),
                item.author(),
                item.cover(),
                item.isbn13(),
                item.isbn(),
                item.priceSales(),
                item.priceStandard(),
                item.pubDate(),
                item.description(),
                item.itemId(),
                item.stockStatus(),
                item.isbn13() != null && bookVolumeRepository.existsVolumeByIsbn13(item.isbn13())
        )).toList();

        String message = viewItems.isEmpty() ? "검색 결과가 없습니다." : null;
        return new AladinSearchView(normalizedQuery, totalResults, viewItems, json, false, message);
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
