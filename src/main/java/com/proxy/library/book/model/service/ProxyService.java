package com.proxy.library.book.model.service;

import com.proxy.library.book.model.dto.Book;
import com.proxy.library.book.model.dto.BookByVolume;
import com.proxy.library.book.model.dto.Branchbook;

import java.util.List;

public interface ProxyService {
    Book findBook();

    int insertBooks(List<Book> books);

    int insertBookByVolume(List<BookByVolume> books);

    int insertStock(List<Branchbook> books);

}
