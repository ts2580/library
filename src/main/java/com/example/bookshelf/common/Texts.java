package com.example.bookshelf.common;

public final class Texts {

    private Texts() {
    }

    public static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public static String trimToEmpty(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null ? "" : trimmed;
    }

    public static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    public static String likePattern(String value) {
        return '%' + removeLikeWildcards(trimToEmpty(value)) + '%';
    }

    public static String removeLikeWildcards(String value) {
        return nullToEmpty(value).replace("%", "").replace("_", "").trim();
    }
}
