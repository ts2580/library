package com.example.bookshelf.integration.aladin;

import com.example.bookshelf.common.Texts;

public record AladinSearchOptions(
        String query,
        String queryType,
        String searchTarget,
        String sort,
        String cover,
        int maxResults,
        int start,
        Integer categoryId,
        int recentPublishFilter,
        boolean outOfStockFilter
) {

    private static final int DEFAULT_MAX_RESULTS = 20;
    private static final int MAX_RESULTS_LIMIT = 100;

    public static AladinSearchOptions simple(String query, int page, int pageSize) {
        return of(query, "Title", "Book", "PublishTime", "Big", pageSize, page, null, 0, false);
    }

    public static AladinSearchOptions of(
            String query,
            String queryType,
            String searchTarget,
            String sort,
            String cover,
            Integer maxResults,
            Integer start,
            Integer categoryId,
            Integer recentPublishFilter,
            boolean outOfStockFilter
    ) {
        return new AladinSearchOptions(
                Texts.trimToEmpty(query),
                oneOf(queryType, "Title", "Keyword", "Author", "Publisher"),
                oneOf(searchTarget, "Book", "Foreign", "Music", "DVD", "Used", "eBook", "All"),
                oneOf(sort, "PublishTime", "Accuracy", "Title", "SalesPoint", "CustomerRating", "MyReviewCount"),
                oneOf(cover, "Big", "MidBig", "Mid", "Small", "Mini", "None"),
                clamp(maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT),
                Math.max(start == null ? 1 : start, 1),
                normalizePositive(categoryId),
                clamp(recentPublishFilter, 0, 0, 60),
                outOfStockFilter
        );
    }

    private static String oneOf(String value, String defaultValue, String... allowed) {
        String normalized = Texts.trimToEmpty(value);
        if (normalized.equalsIgnoreCase(defaultValue)) {
            return defaultValue;
        }
        for (String option : allowed) {
            if (normalized.equalsIgnoreCase(option)) {
                return option;
            }
        }
        return defaultValue;
    }

    private static int clamp(Integer value, int defaultValue, int min, int max) {
        int normalized = value == null ? defaultValue : value;
        return Math.max(min, Math.min(max, normalized));
    }

    private static Integer normalizePositive(Integer value) {
        return value != null && value > 0 ? value : null;
    }
}
