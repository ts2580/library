package com.example.bookshelf.user.model;

public record BranchInventorySummary(
        String branch,
        String branchName,
        int stockCount,
        long totalAmount,
        int pricedCount
) {
}
