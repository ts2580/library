package com.example.bookshelf.user.repository;

import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import org.springframework.jdbc.core.RowMapper;

final class BookRowMappers {

    private BookRowMappers() {
    }

    static final RowMapper<Book> BOOK = (rs, rowNum) -> new Book(
            rs.getInt("id"),
            rs.getString("name"),
            rs.getString("author"),
            rs.getString("description"),
            rs.getString("totalvolume"),
            rs.getString("type"),
            rs.getString("cover"),
            rs.getString("sync"),
            rs.getString("createddate")
    );

    static final RowMapper<BookVolume> BOOK_VOLUME = (rs, rowNum) -> new BookVolume(
            rs.getInt("id"),
            rs.getInt("seq"),
            rs.getInt("book"),
            rs.getString("isbn13"),
            rs.getString("name"),
            rs.getString("cover"),
            rs.getString("price"),
            rs.getBoolean("ispurchased"),
            rs.getString("volume")
    );
}
