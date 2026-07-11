package com.example.bookshelf.integration.aladin;

import com.example.bookshelf.common.Texts;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
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
            List<AladinBranchStock> parsed = findOffStoreStocks(offStoreItem, item, spaceUsed);
            stocks.addAll(parsed);
        }
        return stocks;
    }

    private List<AladinBranchStock> findOffStoreStocks(
            AladinOffStoreItem offStoreItem,
            AladinDropshippingItem item,
            AladinUsedSummary spaceUsed
    ) {
        String branchLink = normalizeLink(offStoreItem.getLink());
        String branchName = textValue(offStoreItem.getOffName());
        String branchCode = textValue(offStoreItem.getOffCode());
        String title = textValue(item.getTitle());

        List<AladinBranchStock> parsed = extractBranchStocks(branchLink, branchName, branchCode, title, spaceUsed);
        if (!parsed.isEmpty()) {
            return parsed;
        }
        return List.of(toFallbackBranchStock(branchCode, branchName, branchLink, title, spaceUsed));
    }

    private List<AladinBranchStock> extractBranchStocks(
            String branchLink,
            String branchName,
            String branchCode,
            String title,
            AladinUsedSummary spaceUsed
    ) {
        if (branchLink == null || branchLink.isBlank()) return Collections.emptyList();
        String html = aladinClient.callRaw(branchLink);
        if (html == null || html.isBlank()) return Collections.emptyList();

        List<AladinBranchStock> parsed = new ArrayList<>();
        try {
            Document doc = Jsoup.parse(html);
            // Aladin's offstore item list usually uses 'ss_book_box' for each item.
            // If that's not present, we fall back to searching for price and quality spans directly.
            Elements itemBoxes = doc.select("div.ss_book_box");

            if (!itemBoxes.isEmpty()) {
                for (Element box : itemBoxes) {
                    Element priceEl = box.selectFirst("span.ss_p2 b");
                    Element qualityEl = box.selectFirst("span.us_f_bob");
                    Element linkEl = box.selectFirst("a[href*=/shop/UsedShop/wuseditemall.aspx?]");

                    if (priceEl != null && qualityEl != null) {
                        String priceText = priceEl.text().replaceAll("[^0-9,]", "");
                        String qualityText = qualityEl.text().trim();
                        String purchaseUrl = linkEl != null ? makeAbsoluteUrl(normalizeLink(linkEl.attr("href"))) : null;

                        parsed.add(new AladinBranchStock(
                                branchCode,
                                branchName,
                                qualityText,
                                branchLink,
                                purchaseUrl,
                                priceText,
                                0,
                                title
                        ));
                    }
                }
            } else {
                // Linear fallback if ss_book_box is missing
                Elements prices = doc.select("span.ss_p2 b");
                Elements qualities = doc.select("span.us_f_bob");
                Elements links = doc.select("a[href*=/shop/UsedShop/wuseditemall.aspx?]");

                int size = Math.min(prices.size(), qualities.size());
                for (int i = 0; i < size; i++) {
                    String priceText = prices.get(i).text().replaceAll("[^0-9,]", "");
                    String qualityText = qualities.get(i).text().trim();
                    String purchaseUrl = i < links.size() ? makeAbsoluteUrl(normalizeLink(links.get(i).attr("href"))) : null;

                    parsed.add(new AladinBranchStock(
                            branchCode,
                            branchName,
                            qualityText,
                            branchLink,
                            purchaseUrl,
                            priceText,
                            0,
                            title
                    ));
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse branch stocks with Jsoup for branchLink={}", branchLink, e);
        }

        if (!parsed.isEmpty() || spaceUsed == null || spaceUsed.getMinPrice() == null) {
            return parsed;
        }
        return List.of(toFallbackBranchStock(branchCode, branchName, branchLink, title, spaceUsed));
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

    private String makeAbsoluteUrl(String url) {
        if (url == null || url.isBlank()) return null;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        return "https://www.aladin.co.kr" + (url.startsWith("/") ? "" : "/") + url;
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
