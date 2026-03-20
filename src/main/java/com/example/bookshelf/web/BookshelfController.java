package com.example.bookshelf.web;

import com.example.bookshelf.user.repository.BookRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class BookshelfController {

    private static final int PAGE_LINK_WINDOW = 5;

    private final AuthSessionHelper authSessionHelper;
    private final BookRepository bookRepository;

    public BookshelfController(AuthSessionHelper authSessionHelper,
                               BookRepository bookRepository) {
        this.authSessionHelper = authSessionHelper;
        this.bookRepository = bookRepository;
    }

    @RequestMapping("/books")
    public String list(HttpSession session,
                       @RequestParam(value = "search", required = false) String search,
                       @RequestParam(value = "page", defaultValue = "1") Integer page,
                       Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        String keyword = search != null ? search.trim() : "";
        boolean hasSearch = !keyword.isEmpty();
        int requestedPage = page == null || page < 1 ? 1 : page;
        int pageSize = bookRepository.defaultPageSize();

        int totalCount = hasSearch ? bookRepository.countSearchBooksByKeyword(keyword) : bookRepository.countAllBooks();
        int totalPages = Math.max(1, (int) Math.ceil(totalCount / (double) pageSize));
        int currentPage = Math.min(requestedPage, totalPages);
        int offset = (currentPage - 1) * pageSize;

        authSessionHelper.populateMember(model, session);
        model.addAttribute("search", keyword);
        model.addAttribute("books", hasSearch
                ? bookRepository.searchBooksByKeywordOrderByVolumeDesc(keyword, pageSize, offset)
                : bookRepository.findAllBooksOrderByCreatedDesc(pageSize, offset));
        model.addAttribute("page", currentPage);
        model.addAttribute("pageSize", pageSize);
        model.addAttribute("totalCount", totalCount);
        model.addAttribute("totalPages", totalPages);
        model.addAttribute("from", totalCount == 0 ? 0 : offset + 1);
        model.addAttribute("to", Math.min(currentPage * pageSize, totalCount));
        model.addAttribute("startPage", getStartPage(currentPage, totalPages));
        model.addAttribute("endPage", getEndPage(currentPage, totalPages));
        return "book_list";
    }

    @GetMapping("/books/{id}")
    public String detail(@PathVariable int id, HttpSession session, Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        var book = bookRepository.findBookById(id);
        if (book == null) {
            return "redirect:/books";
        }

        authSessionHelper.populateMember(model, session);
        model.addAttribute("book", book);
        model.addAttribute("volumes", bookRepository.findVolumesByBookId(id));
        return "book_detail";
    }

    private int getStartPage(int currentPage, int totalPages) {
        int half = PAGE_LINK_WINDOW / 2;
        return Math.max(1, currentPage - half);
    }

    private int getEndPage(int currentPage, int totalPages) {
        int half = PAGE_LINK_WINDOW / 2;
        int end = currentPage + half;
        if (totalPages <= PAGE_LINK_WINDOW) {
            return totalPages;
        }
        if (end > totalPages) {
            return totalPages;
        }
        int start = getStartPage(currentPage, totalPages);
        int width = Math.min(PAGE_LINK_WINDOW, totalPages);
        return Math.min(totalPages, start + width - 1);
    }
}
