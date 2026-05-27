package com.example.bookshelf.web.viewmodel;

import com.example.bookshelf.user.model.Book;

import java.util.List;

public record BookListViewModel(
        String search,
        String type,
        String title,
        String author,
        boolean hasAdvancedFilters,
        List<String> types,
        List<Book> books,
        PageWindow page
) {
}
