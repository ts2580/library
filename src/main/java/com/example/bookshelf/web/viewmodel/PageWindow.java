package com.example.bookshelf.web.viewmodel;

public record PageWindow(
        int currentPage,
        int pageSize,
        int totalItems,
        int totalPages,
        int offset,
        int from,
        int to,
        int startPage,
        int endPage
) {
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int DEFAULT_LINK_WINDOW = 5;

    public static PageWindow of(int requestedPage, int totalItems, int pageSize) {
        return of(requestedPage, totalItems, pageSize, DEFAULT_LINK_WINDOW);
    }

    public static PageWindow of(int requestedPage, int totalItems, int pageSize, int linkWindow) {
        int safePageSize = pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
        int safeTotalItems = Math.max(0, totalItems);
        int totalPages = Math.max(1, (int) Math.ceil(safeTotalItems / (double) safePageSize));
        int currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
        int offset = (currentPage - 1) * safePageSize;
        int from = safeTotalItems == 0 ? 0 : offset + 1;
        int to = Math.min(currentPage * safePageSize, safeTotalItems);

        int width = Math.max(1, Math.min(linkWindow > 0 ? linkWindow : DEFAULT_LINK_WINDOW, totalPages));
        int startPage = Math.max(1, currentPage - (width / 2));
        int endPage = startPage + width - 1;
        if (endPage > totalPages) {
            endPage = totalPages;
            startPage = Math.max(1, endPage - width + 1);
        }

        return new PageWindow(currentPage, safePageSize, safeTotalItems, totalPages, offset, from, to, startPage, endPage);
    }
}
