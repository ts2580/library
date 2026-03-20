package com.example.bookshelf.integration.aladin;

import java.util.List;

public record AladinUsedView(
        String isbn13,
        String type,
        int totalCount,
        Integer minPrice,
        List<AladinBranchStock> stocks,
        String rawJson,
        boolean hasError,
        String message
) {}
