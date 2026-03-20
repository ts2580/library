package com.example.bookshelf.integration.aladin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class AladinApiService {

    private static final Logger log = LoggerFactory.getLogger(AladinApiService.class);
    private static final int PAGE_SIZE = 20;
    private static final Pattern BRANCH_STOCK_PATTERN = Pattern.compile(
            "<div class='ss_book_list'>\\s*<ul>.*?<b>최저가</b>\\s*:\\s*<span class='ss_p2'><b>([0-9,]+)원</b>.*?</div>\\s*<div class='ss_book_list'>\\s*<ul>.*?<b>상태\\s*:?<span class='us_f_bob'>\\s*([^<]+)",
            Pattern.DOTALL
    );
    private static final Pattern BRANCH_PURCHASE_URL_PATTERN = Pattern.compile(
            "(/shop/UsedShop/wuseditemall\\.aspx\\?[^\\s>]+)",
            Pattern.CASE_INSENSITIVE
    );

    private final IF_Util ifUtil;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public AladinApiService(IF_Util ifUtil) {
        this.ifUtil = ifUtil;
        this.restTemplate = new RestTemplate();
        this.objectMapper = new ObjectMapper();
    }

    public AladinSearchResult searchBookItems(String query, int page) {
        int currentPage = Math.max(page, 1);
        String url = ifUtil.getBookInfoURL(query, currentPage, PAGE_SIZE);
        log.info("[aladin] searchBookItems query='{}', page={}, url={}", query, currentPage, url);
        String json = call(url);
        if (json == null || json.startsWith("{\"error\"")) {
            log.warn("[aladin] raw response is null/error for query='{}'", query);
            return new AladinSearchResult(Collections.emptyList(), 0, currentPage, PAGE_SIZE);
        }

        log.info("[aladin] raw prefix for query='{}': {}", query, json.substring(0, Math.min(300, json.length())).replaceAll("\\s+", " "));

        try {
            JsonNode root = objectMapper.readTree(json);
            JsonNode items = root.path("item");
            int totalResults = parseIntSafe(root.path("totalResults"));

            if (!items.isArray()) {
                log.warn("[aladin] item is not array for query='{}', totalResults={}", query, totalResults);
                return new AladinSearchResult(Collections.emptyList(), totalResults, currentPage, PAGE_SIZE);
            }

            List<AladinItem> result = new ArrayList<>();
            for (JsonNode item : items) {
                result.add(toAladinItem(item));
            }
            log.info("[aladin] parsed query='{}' totalResults={}, items.size={}", query, totalResults, result.size());
            if (!result.isEmpty()) {
                var first = result.get(0);
                log.info("[aladin] first parsed item title='{}', author='{}', isbn13='{}'", first.title(), first.author(), first.isbn13());
            }
            return new AladinSearchResult(result, totalResults, currentPage, PAGE_SIZE);
        } catch (Exception e) {
            log.warn("Failed to parse Aladin search response for query='{}', page={}", query, currentPage, e);
            return new AladinSearchResult(Collections.emptyList(), 0, currentPage, PAGE_SIZE);
        }
    }

    public AladinSearchResult searchBookItems(String query) {
        return searchBookItems(query, 1);
    }

    public AladinSearchView searchBookView(String query) {
        String normalizedQuery = query == null ? "" : query.trim();
        String json = call(ifUtil.getBookInfoURL(normalizedQuery, 1, PAGE_SIZE));
        if (json == null || json.startsWith("{\"error\"")) {
            return new AladinSearchView(normalizedQuery, 0, Collections.emptyList(), json, true, "알라딘 검색 응답을 가져오지 못했어요.");
        }

        try {
            JsonNode root = objectMapper.readTree(json);
            int totalResults = parseIntSafe(root.path("totalResults"));
            List<AladinItem> items = new ArrayList<>();
            if (root.path("item").isArray()) {
                for (JsonNode item : root.path("item")) {
                    items.add(toAladinItem(item));
                }
            }
            return new AladinSearchView(normalizedQuery, totalResults, items, json, false, items.isEmpty() ? "검색 결과가 없어요." : null);
        } catch (Exception e) {
            log.warn("Failed to build AladinSearchView for query={}", normalizedQuery, e);
            return new AladinSearchView(normalizedQuery, 0, Collections.emptyList(), json, true, "알라딘 검색 결과를 파싱하지 못했어요.");
        }
    }

    public AladinUsedView usedBookView(String isbn13, String type) {
        String normalizedIsbn13 = isbn13 == null ? "" : isbn13.trim();
        String normalizedType = type == null ? "dropshipping" : type.trim();
        String rawJson = "dropshipping".equalsIgnoreCase(normalizedType)
                ? findDropshippingUsedBook(normalizedIsbn13)
                : findUsedBookInfo(normalizedIsbn13);

        List<AladinBranchStock> stocks = findUsedStocksByIsbn13(normalizedIsbn13);
        Integer minPrice = stocks.stream()
                .map(AladinBranchStock::price)
                .filter(v -> v != null && !v.isBlank())
                .map(v -> v.replace(",", ""))
                .filter(v -> v.matches("\\d+"))
                .map(Integer::parseInt)
                .min(Integer::compareTo)
                .orElse(null);

        boolean hasError = rawJson == null || rawJson.startsWith("{\"error\"");
        String message = hasError ? "알라딘 중고 응답을 가져오지 못했어요." : (stocks.isEmpty() ? "중고 재고가 없어요." : null);
        return new AladinUsedView(normalizedIsbn13, normalizedType, stocks.size(), minPrice, stocks, rawJson, hasError, message);
    }

    public List<AladinBranchStock> findUsedStocksByIsbn13(String isbn13) {
        if (isbn13 == null || isbn13.trim().isEmpty()) {
            return Collections.emptyList();
        }

        String dropshippingJson = call(ifUtil.getDropshippingUsedBookURL(isbn13.trim()));
        if (dropshippingJson == null || dropshippingJson.startsWith("{\"error\"")) {
            return Collections.emptyList();
        }

        try {
            AladinDropshippingResponse response = objectMapper.readValue(dropshippingJson, AladinDropshippingResponse.class);
            if (response == null || response.getItem() == null || response.getItem().isEmpty()) {
                return Collections.emptyList();
            }

            AladinDropshippingItem item = response.getItem().get(0);
            AladinUsedList usedList = item != null && item.getSubInfo() != null ? item.getSubInfo().getUsedList() : null;
            AladinUsedSummary aladinUsed = usedList != null ? usedList.getAladinUsed() : null;
            AladinUsedSummary spaceUsed = usedList != null ? usedList.getSpaceUsed() : null;

            int aladinCount = parseIntSafeInt(aladinUsed == null ? null : String.valueOf(aladinUsed.getItemCount()));
            int spaceCount = parseIntSafeInt(spaceUsed == null ? null : String.valueOf(spaceUsed.getItemCount()));
            boolean hasAladin = aladinCount > 0;
            boolean hasSpace = spaceCount > 0;

            if (!hasAladin && !hasSpace) {
                return Collections.emptyList();
            }

            List<AladinBranchStock> stocks = new ArrayList<>();
            if (hasAladin) {
                stocks.add(new AladinBranchStock("ALADIN_DROPSHIPPING", "알라딘 직배송", null, normalizeLink(aladinUsed.getLink()), normalizeLink(aladinUsed.getLink()), toString(aladinUsed.getMinPrice()), 0, textValue(item.getTitle())));
            }

            if (hasSpace) {
                String usedInfoJson = call(ifUtil.getUsedBookInfoURL(isbn13.trim()));
                if (usedInfoJson == null || usedInfoJson.startsWith("{\"error\"")) {
                    return stocks;
                }

                AladinUsedInfoResponse usedInfo = objectMapper.readValue(usedInfoJson, AladinUsedInfoResponse.class);
                if (usedInfo != null && usedInfo.getItemOffStoreList() != null) {
                    for (AladinOffStoreItem offStoreItem : usedInfo.getItemOffStoreList()) {
                        if (offStoreItem == null) continue;
                        String branchLink = normalizeLink(offStoreItem.getLink());
                        List<AladinBranchStock> parsed = extractBranchStocks(branchLink, textValue(offStoreItem.getOffName()), textValue(offStoreItem.getOffCode()), textValue(item.getTitle()), spaceUsed);
                        if (parsed.isEmpty()) {
                            String branchPrice = spaceUsed == null ? null : toString(spaceUsed.getMinPrice());
                            stocks.add(new AladinBranchStock(textValue(offStoreItem.getOffCode()), textValue(offStoreItem.getOffName()), null, branchLink, branchLink, branchPrice, 0, textValue(item.getTitle())));
                        } else {
                            stocks.addAll(parsed);
                        }
                    }
                }
            }
            return stocks;
        } catch (Exception e) {
            log.warn("Failed to fetch used stocks for isbn13={}", isbn13, e);
            return Collections.emptyList();
        }
    }

    private AladinItem toAladinItem(JsonNode item) {
        return new AladinItem(text(item, "title"), text(item, "author"), text(item, "cover"), text(item, "isbn13"), text(item, "isbn"), text(item, "priceSales"), text(item, "priceStandard"), text(item, "pubDate"), text(item, "description"), text(item, "itemId"), text(item, "stockStatus"));
    }

    private String callRaw(String url) {
        try {
            return restTemplate.getForObject(URI.create(url), String.class);
        } catch (RestClientException e) {
            log.debug("Raw call failed for url={}", url, e);
            return null;
        }
    }

    public String findDropshippingUsedBook(String isbn13) { return call(ifUtil.getDropshippingUsedBookURL(isbn13)); }
    public String findUsedBookInfo(String isbn13) { return call(ifUtil.getUsedBookInfoURL(isbn13)); }
    public String searchBook(String query) { return call(ifUtil.getBookInfoURL(query)); }

    private List<AladinBranchStock> extractBranchStocks(String branchLink, String branchName, String branchCode, String title, AladinUsedSummary spaceUsed) {
        if (branchLink == null || branchLink.isBlank()) return Collections.emptyList();
        String html = callRaw(branchLink);
        if (html == null || html.isBlank()) return Collections.emptyList();

        List<AladinBranchStock> parsed = new ArrayList<>();
        List<String> purchaseLinks = new ArrayList<>();
        Matcher buyMatcher = BRANCH_PURCHASE_URL_PATTERN.matcher(html);
        while (buyMatcher.find()) {
            String buyUrl = normalizeLink(buyMatcher.group(1)).replaceAll("[\"']+$", "");
            purchaseLinks.add(normalizeLink(buyUrl));
        }

        Matcher matcher = BRANCH_STOCK_PATTERN.matcher(html);
        boolean hasMatch = false;
        int index = 0;
        while (matcher.find()) {
            hasMatch = true;
            String price = matcher.group(1);
            String state = textValue(matcher.group(2));
            String purchaseUrl = index < purchaseLinks.size() ? makeAbsoluteUrl(purchaseLinks.get(index)) : null;
            parsed.add(new AladinBranchStock(branchCode, branchName, state, branchLink, purchaseUrl, price, 0, title));
            index++;
        }

        if (hasMatch) return parsed;
        if (spaceUsed != null && spaceUsed.getMinPrice() != null) {
            parsed.add(new AladinBranchStock(branchCode, branchName, null, branchLink, branchLink, toString(spaceUsed.getMinPrice()), 0, title));
        }
        return parsed;
    }

    private String makeAbsoluteUrl(String url) {
        if (url == null || url.isBlank()) return null;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        return "http://www.aladin.co.kr" + (url.startsWith("/") ? "" : "/") + url;
    }

    private String call(String url) {
        try {
            return restTemplate.getForObject(URI.create(url), String.class);
        } catch (RestClientException e) {
            String safeMessage = e.getMessage() == null ? "unknown" : e.getMessage().replace("\\", "\\\\").replace("\"", "\\\"");
            log.warn("Aladin API call failed for url={}", url, e);
            return "{\"error\": \"failed\", \"message\": \"" + safeMessage + "\"}";
        }
    }

    private String text(JsonNode node, String fieldName) {
        JsonNode value = node.path(fieldName);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private String textValue(String value) { return value == null ? "" : value; }

    private String toString(Integer value) { return value == null ? null : String.valueOf(value); }

    private String normalizeLink(String value) { return value == null ? null : value.replace("amp;", ""); }

    private int parseIntSafeInt(String value) {
        try {
            return Integer.parseInt(value == null ? "0" : value);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private int parseIntSafe(JsonNode node) {
        return parseIntSafeInt(node == null ? null : node.asText("0"));
    }
}
