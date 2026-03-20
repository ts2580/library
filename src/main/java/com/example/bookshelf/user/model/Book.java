package com.example.bookshelf.user.model;

public record Book(
        int id,
        String name,
        String author,
        String description,
        String totalvolume,
        String type,
        String cover,
        String sync,
        String createddate
) {
}
