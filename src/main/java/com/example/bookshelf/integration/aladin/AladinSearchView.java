package com.example.bookshelf.integration.aladin;

import java.util.List;

public record AladinSearchView(
        String query,
        int totalResults,
        List<AladinItem> items,
        String rawJson,
        boolean hasError,
        String message
) {}
