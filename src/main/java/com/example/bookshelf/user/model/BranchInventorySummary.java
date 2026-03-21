package com.example.bookshelf.user.model;

import java.time.LocalDateTime;

public record BranchInventorySummary(
        String branch,
        String branchName,
        int stockCount,
        long totalAmount,
        int pricedCount,
        LocalDateTime updatedAt
) {
}
