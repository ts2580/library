package com.proxy.library.book.model.service;

import com.proxy.library.book.model.dto.Book;
import com.proxy.library.book.model.dto.BookByVolume;
import com.proxy.library.book.model.dto.Branchbook;

import java.util.List;

public interface ProxyService {
    Book findBook();

    List<BookByVolume> getBookByVolume(String title);

    int insertBooks(List<Book> books);

    int insertBookByVolumes(List<BookByVolume> books);

    int updtBookByVolume(List<BookByVolume> books);

    List<BookByVolume> getBookByVolumeNew();

    int insertStock(List<Branchbook> books);

    List<BookByVolume> getTargetBook();

    void delBooks();

    void updtBookPrc();

    int setBookStockByBranch(List<Branchbook> paramBooks);
}
