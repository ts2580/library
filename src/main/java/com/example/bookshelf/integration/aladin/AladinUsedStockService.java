package com.example.bookshelf.integration.aladin;

import com.example.bookshelf.common.Texts;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Service
public class AladinUsedStockService {

    private static final Logger log = LoggerFactory.getLogger(AladinUsedStockService.class);

    private final AladinClient aladinClient;
    private final ObjectMapper objectMapper;

    public AladinUsedStockService(AladinClient aladinClient, ObjectMapper objectMapper) {
        this.aladinClient = aladinClient;
        this.objectMapper = objectMapper;
    }

    public boolean isApiConfigured() {
        return aladinClient.isApiConfigured();
    }

    public AladinUsedView usedBookView(String isbn13, String type) {
        String normalizedIsbn13 = Texts.trimToEmpty(isbn13);
        String normalizedType = Texts.trimToNull(type) == null ? "dropshipping" : type.trim();

        try {
            Object response;
            if ("dropshipping".equalsIgnoreCase(normalizedType)) {
                response = aladinClient.getDropshippingUsedBook(normalizedIsbn13);
            } else {
                response = aladinClient.getUsedBookInfo(normalizedIsbn13);
            }

            String rawJson = serializeToJson(response);
            List<AladinBranchStock> stocks = findUsedStocksByIsbn13(normalizedIsbn13);
            Integer minPrice = findMinPrice(stocks);
            boolean hasError = response == null;
            String message = hasError ? "알라딘 중고 응답을 가져오지 못했습니다." : (stocks.isEmpty() ? "중고 재고가 없습니다." : null);
            return new AladinUsedView(normalizedIsbn13, normalizedType, stocks.size(), minPrice, stocks, rawJson, hasError, message);
        } catch (AladinRateLimitException e) {
            log.warn("Used stock view stopped by Aladin API rate limit for isbn13={}", normalizedIsbn13);
            return new AladinUsedView(
                    normalizedIsbn13,
                    normalizedType,
                    0,
                    null,
                    List.of(),
                    "{}",
                    true,
                    "알라딘 API 호출 제한(429)으로 조회하지 못했습니다. 잠시 후 다시 시도해 주세요."
            );
        }
    }

    public List<AladinBranchStock> findUsedStocksByIsbn13(String isbn13) {
        StockLookupResult result = lookupUsedStocksByIsbn13(isbn13);
        return result.successful() ? result.stocks() : Collections.emptyList();
    }

    public StockLookupResult lookupUsedStocksByIsbn13(String isbn13) {
        String normalizedIsbn13 = Texts.trimToNull(isbn13);
        if (normalizedIsbn13 == null) {
            return StockLookupResult.failure("ISBN13이 없습니다.");
        }

        AladinDropshippingResponse dropshippingResponse = aladinClient.getDropshippingUsedBook(normalizedIsbn13);
        if (dropshippingResponse == null) {
            return StockLookupResult.failure("알라딘 중고 응답을 가져오지 못했습니다.");
        }

        try {
            AladinDropshippingItem item = readFirstDropshippingItem(dropshippingResponse);
            if (item == null) {
                return StockLookupResult.success(Collections.emptyList());
            }

            AladinUsedList usedList = item.getSubInfo() == null ? null : item.getSubInfo().getUsedList();
            AladinUsedSummary aladinUsed = usedList == null ? null : usedList.getAladinUsed();
            AladinUsedSummary spaceUsed = usedList == null ? null : usedList.getSpaceUsed();

            boolean hasAladin = itemCount(aladinUsed) > 0;
            boolean hasSpace = itemCount(spaceUsed) > 0;
            if (!hasAladin && !hasSpace) {
                return StockLookupResult.success(Collections.emptyList());
            }

            List<AladinBranchStock> stocks = new ArrayList<>();
            if (hasAladin) {
                stocks.add(toDropshippingStock(aladinUsed, item));
            }
            if (hasSpace) {
                stocks.addAll(findSpaceUsedStocks(normalizedIsbn13, item, spaceUsed));
            }
            return StockLookupResult.success(stocks);
        } catch (AladinRateLimitException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Failed to fetch used stocks for isbn13={}", normalizedIsbn13, e);
            return StockLookupResult.failure("알라딘 중고 재고 조회에 실패했습니다.");
        }
    }

    private AladinDropshippingItem readFirstDropshippingItem(AladinDropshippingResponse response) {
        if (response == null || response.getItem() == null || response.getItem().isEmpty()) {
            return null;
        }
        return response.getItem().get(0);
    }

    private List<AladinBranchStock> findSpaceUsedStocks(
            String isbn13,
            AladinDropshippingItem item,
            AladinUsedSummary spaceUsed
    ) {
        AladinUsedInfoResponse usedInfo = aladinClient.getUsedBookInfo(isbn13);
        if (usedInfo == null) {
            throw new IllegalStateException("알라딘 지점 재고 응답을 가져오지 못했습니다.");
        }
        if (usedInfo.getItemOffStoreList() == null) {
            return Collections.emptyList();
        }

        List<AladinBranchStock> stocks = new ArrayList<>();
        for (AladinOffStoreItem offStoreItem : usedInfo.getItemOffStoreList()) {
            if (offStoreItem == null) continue;
            stocks.add(toFallbackBranchStock(
                    textValue(offStoreItem.getOffCode()),
                    textValue(offStoreItem.getOffName()),
                    normalizeLink(offStoreItem.getLink()),
                    textValue(item.getTitle()),
                    spaceUsed
            ));
        }
        return stocks;
    }

    private AladinBranchStock toDropshippingStock(AladinUsedSummary aladinUsed, AladinDropshippingItem item) {
        String link = normalizeLink(aladinUsed.getLink());
        return new AladinBranchStock(
                "ALADIN_DROPSHIPPING",
                "알라딘 직배송",
                null,
                link,
                link,
                toString(aladinUsed.getMinPrice()),
                0,
                textValue(item.getTitle())
        );
    }

    private AladinBranchStock toFallbackBranchStock(
            String branchCode,
            String branchName,
            String branchLink,
            String title,
            AladinUsedSummary spaceUsed
    ) {
        String branchPrice = spaceUsed == null ? null : toString(spaceUsed.getMinPrice());
        return new AladinBranchStock(branchCode, branchName, null, branchLink, branchLink, branchPrice, 0, title);
    }

    private Integer findMinPrice(List<AladinBranchStock> stocks) {
        return stocks.stream()
                .map(AladinBranchStock::price)
                .filter(value -> value != null && !value.isBlank())
                .map(value -> value.replace(",", ""))
                .filter(value -> value.matches("\\d+"))
                .map(Integer::parseInt)
                .min(Integer::compareTo)
                .orElse(null);
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

    private String textValue(String value) {
        return value == null ? "" : value;
    }

    private String toString(Integer value) {
        return value == null ? null : String.valueOf(value);
    }

    private String normalizeLink(String value) {
        return value == null ? null : value.replace("amp;", "");
    }

    private int itemCount(AladinUsedSummary summary) {
        return summary == null || summary.getItemCount() == null ? 0 : summary.getItemCount();
    }

    public record StockLookupResult(boolean successful, List<AladinBranchStock> stocks, String errorMessage) {
        public StockLookupResult {
            stocks = stocks == null ? List.of() : List.copyOf(stocks);
        }

        public static StockLookupResult success(List<AladinBranchStock> stocks) {
            return new StockLookupResult(true, stocks, null);
        }

        public static StockLookupResult failure(String errorMessage) {
            return new StockLookupResult(false, List.of(), errorMessage);
        }
    }
}
