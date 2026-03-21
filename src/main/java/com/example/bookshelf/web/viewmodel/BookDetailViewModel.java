package com.example.bookshelf.web.viewmodel;

import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;

import java.util.List;

public record BookDetailViewModel(
        Book book,
        List<BookVolume> volumes,
        List<String> bookTypes
) {
}
