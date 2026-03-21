package com.example.bookshelf.web.viewmodel;

import com.example.bookshelf.integration.aladin.AladinItem;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;

import java.util.List;

public record ProductSearchViewModel(
        String ownedQ,
        String query,
        String ownedSort,
        int pageSize,
        List<String> bookTypes,
        List<BookVolume> ownedVolumes,
        List<Book> ownedBooks,
        int ownedPage,
        int ownedFrom,
        int ownedTo,
        int totalOwned,
        int totalOwnedPages,
        int ownedStartPage,
        int ownedEndPage,
        int aladinPage,
        List<AladinItem> aladinResults,
        int totalAladinResults,
        int totalAladinPages,
        int aladinFrom,
        int aladinTo,
        int aladinStartPage,
        int aladinEndPage
) {
    public static ProductSearchViewModel of(
            String ownedQ,
            String query,
            String ownedSort,
            int pageSize,
            List<String> bookTypes,
            List<BookVolume> ownedVolumes,
            List<Book> ownedBooks,
            int requestedOwnedPage,
            int totalOwned,
            int requestedAladinPage,
            List<AladinItem> aladinResults,
            int totalAladinResults
    ) {
        int totalOwnedPages = Math.max(1, (int) Math.ceil(totalOwned / (double) pageSize));
        int ownedPage = Math.min(requestedOwnedPage, totalOwnedPages);
        int ownedOffset = (ownedPage - 1) * pageSize;

        int totalAladinPages = Math.max(1, (int) Math.ceil(totalAladinResults / (double) pageSize));
        int aladinPage = Math.min(requestedAladinPage, totalAladinPages);

        return new ProductSearchViewModel(
                ownedQ,
                query,
                ownedSort,
                pageSize,
                bookTypes,
                ownedVolumes,
                ownedBooks,
                ownedPage,
                totalOwned == 0 ? 0 : ownedOffset + 1,
                Math.min(ownedPage * pageSize, totalOwned),
                totalOwned,
                totalOwnedPages,
                startPage(ownedPage, totalOwnedPages),
                endPage(ownedPage, totalOwnedPages),
                aladinPage,
                aladinResults,
                totalAladinResults,
                totalAladinPages,
                totalAladinResults == 0 ? 0 : ((aladinPage - 1) * pageSize) + 1,
                Math.min(aladinPage * pageSize, totalAladinResults),
                startPage(aladinPage, totalAladinPages),
                endPage(aladinPage, totalAladinPages)
        );
    }

    private static int startPage(int currentPage, int totalPages) {
        int half = 5 / 2;
        return Math.max(1, currentPage - half);
    }

    private static int endPage(int currentPage, int totalPages) {
        int half = 5 / 2;
        int end = currentPage + half;
        if (totalPages <= 5) return totalPages;
        if (end > totalPages) return totalPages;
        int start = startPage(currentPage, totalPages);
        int width = Math.min(5, totalPages);
        return Math.min(totalPages, start + width - 1);
    }
}
