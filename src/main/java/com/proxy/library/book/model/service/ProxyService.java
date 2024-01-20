package com.proxy.library.book.model.service;

import com.proxy.library.book.model.dto.Book;

import java.util.List;

public interface ProxyService {
    Book findBook();

    int books(List<Book> books);

}
