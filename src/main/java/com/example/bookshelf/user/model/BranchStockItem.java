package com.example.bookshelf.user.model;

public record BranchStockItem(
        int id,
        String branch,
        String branchName,
        int bookId,
        String grade,
        String bookTitle,
        String volumeTitle,
        String isbn13,
        String cover,
        String price,
        String bookLink,
        String purchaseLink
) {
}
