package com.example.bookshelf.web.viewmodel;

import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import org.jsoup.parser.Parser;

import java.util.List;

public record BookDetailViewModel(
        Book book,
        List<BookVolume> volumes,
        List<String> bookTypes
) {
    public static BookDetailViewModel forDisplay(Book book, List<BookVolume> volumes, List<String> bookTypes) {
        List<BookVolume> displayVolumes = volumes == null ? List.of() : volumes.stream()
                .map(BookDetailViewModel::decodeVolumeDescription)
                .toList();
        return new BookDetailViewModel(
                decodeBookDescription(book, displayVolumes.size()),
                displayVolumes,
                bookTypes
        );
    }

    private static Book decodeBookDescription(Book book, int volumeCount) {
        if (book == null) {
            return null;
        }
        return new Book(
                book.id(),
                book.name(),
                book.author(),
                decodeHtmlEntities(book.description()),
                String.valueOf(volumeCount),
                book.type(),
                book.cover(),
                book.sync(),
                book.createddate()
        );
    }

    private static BookVolume decodeVolumeDescription(BookVolume volume) {
        if (volume == null) {
            return null;
        }
        return new BookVolume(
                volume.id(),
                volume.seq(),
                volume.bookId(),
                volume.isbn13(),
                volume.name(),
                volume.cover(),
                volume.price(),
                decodeHtmlEntities(volume.description()),
                volume.purchased(),
                volume.noNeedToBuy(),
                volume.volume()
        );
    }

    private static String decodeHtmlEntities(String value) {
        if (value == null || value.isBlank()) {
            return value;
        }
        return Parser.unescapeEntities(value, false);
    }
}
