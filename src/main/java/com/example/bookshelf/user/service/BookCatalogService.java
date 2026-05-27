package com.example.bookshelf.user.service;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.web.viewmodel.BookListViewModel;
import com.example.bookshelf.web.viewmodel.PageWindow;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class BookCatalogService {

    private static final int BOOK_PAGE_SIZE = 20;
    private static final int PAGE_LINK_WINDOW = 5;

    private final BookDataRepository bookDataRepository;

    public BookCatalogService(BookDataRepository bookDataRepository) {
        this.bookDataRepository = bookDataRepository;
    }

    public BookListViewModel findBookList(String search, String type, String title, String author, Integer page) {
        String keyword = Texts.trimToEmpty(search);
        String selectedType = Texts.trimToEmpty(type);
        String titleKeyword = Texts.trimToEmpty(title);
        String authorKeyword = Texts.trimToEmpty(author);

        boolean hasSearch = !keyword.isEmpty();
        boolean hasType = !selectedType.isEmpty();
        boolean hasTitle = !titleKeyword.isEmpty();
        boolean hasAuthor = !authorKeyword.isEmpty();
        boolean hasAdvancedFilters = hasTitle || hasAuthor;

        int totalCount = countBooks(keyword, selectedType, titleKeyword, authorKeyword, hasSearch, hasType, hasAdvancedFilters);
        PageWindow pageWindow = PageWindow.of(page == null ? 1 : page, totalCount, BOOK_PAGE_SIZE, PAGE_LINK_WINDOW);
        List<Book> books = findBooks(keyword, selectedType, titleKeyword, authorKeyword, hasSearch, hasType, hasAdvancedFilters, pageWindow);

        return new BookListViewModel(
                keyword,
                selectedType,
                titleKeyword,
                authorKeyword,
                hasAdvancedFilters,
                bookDataRepository.findAllBookTypes(),
                books,
                pageWindow
        );
    }

    private int countBooks(String keyword,
                           String selectedType,
                           String titleKeyword,
                           String authorKeyword,
                           boolean hasSearch,
                           boolean hasType,
                           boolean hasAdvancedFilters) {
        if (hasAdvancedFilters) {
            return bookDataRepository.countBooksByFilters(titleKeyword, authorKeyword, selectedType);
        }
        if (hasSearch && hasType) {
            return bookDataRepository.countSearchBooksByKeywordAndType(keyword, selectedType);
        }
        if (hasSearch) {
            return bookDataRepository.countSearchBooksByKeyword(keyword);
        }
        if (hasType) {
            return bookDataRepository.countBooksByType(selectedType);
        }
        return bookDataRepository.countAllBooks();
    }

    private List<Book> findBooks(String keyword,
                                 String selectedType,
                                 String titleKeyword,
                                 String authorKeyword,
                                 boolean hasSearch,
                                 boolean hasType,
                                 boolean hasAdvancedFilters,
                                 PageWindow pageWindow) {
        if (hasAdvancedFilters) {
            return bookDataRepository.findBooksByFiltersOrderByCreatedDesc(titleKeyword, authorKeyword, selectedType, pageWindow.pageSize(), pageWindow.offset());
        }
        if (hasSearch && hasType) {
            return bookDataRepository.searchBooksByKeywordAndType(keyword, selectedType, pageWindow.pageSize(), pageWindow.offset());
        }
        if (hasSearch) {
            return bookDataRepository.searchBooksByKeywordOrderByVolumeDesc(keyword, pageWindow.pageSize(), pageWindow.offset());
        }
        if (hasType) {
            return bookDataRepository.findAllBooksByTypeAndCreatedDesc(selectedType, pageWindow.pageSize(), pageWindow.offset());
        }
        return bookDataRepository.findAllBooksOrderByCreatedDesc(pageWindow.pageSize(), pageWindow.offset());
    }
}
