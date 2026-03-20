package com.example.bookshelf.user.model;

public record BookVolume(
        int id,
        int seq,
        int bookId,
        String isbn13,
        String name,
        String cover,
        String price,
        boolean purchased,
        String volume
) {
}
