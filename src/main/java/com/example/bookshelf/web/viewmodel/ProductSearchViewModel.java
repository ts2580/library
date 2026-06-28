package com.example.bookshelf.web.viewmodel;

import com.example.bookshelf.integration.aladin.AladinSearchViewItem;
import com.example.bookshelf.user.model.BookVolume;

import java.util.List;

public record ProductSearchViewModel(
        String ownedQ,
        String query,
        String ownedSort,
        int pageSize,
        List<String> bookTypes,
        List<BookVolume> ownedVolumes,
        int ownedPage,
        int ownedFrom,
        int ownedTo,
        int totalOwned,
        int totalOwnedPages,
        int ownedStartPage,
        int ownedEndPage,
        int aladinPage,
        List<AladinSearchViewItem> aladinResults,
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
            int requestedOwnedPage,
            int totalOwned,
            int requestedAladinPage,
            List<AladinSearchViewItem> aladinResults,
            int totalAladinResults
    ) {
        PageWindow ownedWindow = PageWindow.of(requestedOwnedPage, totalOwned, pageSize);
        PageWindow aladinWindow = PageWindow.of(requestedAladinPage, totalAladinResults, pageSize);

        return new ProductSearchViewModel(
                ownedQ,
                query,
                ownedSort,
                pageSize,
                bookTypes,
                ownedVolumes,
                ownedWindow.currentPage(),
                ownedWindow.from(),
                ownedWindow.to(),
                ownedWindow.totalItems(),
                ownedWindow.totalPages(),
                ownedWindow.startPage(),
                ownedWindow.endPage(),
                aladinWindow.currentPage(),
                aladinResults,
                aladinWindow.totalItems(),
                aladinWindow.totalPages(),
                aladinWindow.from(),
                aladinWindow.to(),
                aladinWindow.startPage(),
                aladinWindow.endPage()
        );
    }
}
