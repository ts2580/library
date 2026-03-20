package com.example.bookshelf.user.model;

public record BranchBook(
        int id,
        String booklink,
        String branch,
        String uuid,
        Double volume,
        String name,
        String price,
        String branchName,
        String grade,
        String createdDate,
        Integer bookId
) {
}
