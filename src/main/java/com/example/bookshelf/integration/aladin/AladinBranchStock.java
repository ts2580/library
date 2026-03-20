package com.example.bookshelf.integration.aladin;

public record AladinBranchStock(
        String branch,
        String branchName,
        String grade,
        String bookLink,
        String purchaseLink,
        String price,
        int volume,
        String title
) {
}
