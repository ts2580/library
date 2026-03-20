package com.example.bookshelf.integration.aladin;

public record AladinItem(
        String title,
        String author,
        String cover,
        String isbn13,
        String isbn,
        String priceSales,
        String priceStandard,
        String pubDate,
        String description,
        String itemId,
        String stockStatus
) {
}
