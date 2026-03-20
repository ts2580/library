package com.example.bookshelf.integration.aladin;

import java.util.List;

public record AladinSearchResult(
        List<AladinItem> items,
        int totalResults,
        int page,
        int pageSize
) {
}
