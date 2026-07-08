package com.example.bookshelf.integration.aladin;

public final class AladinCoverUtils {

    private AladinCoverUtils() {
    }

    public static String toCover500(String coverUrl) {
        if (coverUrl == null || coverUrl.isEmpty()) {
            return coverUrl;
        }

        if (!coverUrl.contains("aladin.co.kr")) {
            return coverUrl;
        }

        return coverUrl
                .replace("cover200", "cover500")
                .replace("cover150", "cover500")
                .replace("coversum", "cover500");
    }
}
