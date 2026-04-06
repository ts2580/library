package com.example.bookshelf.web;

import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.web.viewmodel.BookDetailViewModel;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import java.util.List;

@Controller
public class BookshelfController {

    private static final int PAGE_LINK_WINDOW = 5;

    private final AuthSessionHelper authSessionHelper;
    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;

    public BookshelfController(AuthSessionHelper authSessionHelper,
                               BookDataRepository bookDataRepository,
                               BookVolumeRepository bookVolumeRepository) {
        this.authSessionHelper = authSessionHelper;
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
    }

    @RequestMapping("/books")
    public String list(HttpSession session,
                       @RequestParam(value = "search", required = false) String search,
                       @RequestParam(value = "page", defaultValue = "1") Integer page,
                       @RequestParam(value = "type", required = false) String type,
                       @RequestParam(value = "title", required = false) String title,
                       @RequestParam(value = "author", required = false) String author,
                       Model model) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";

        String keyword = search != null ? search.trim() : "";
        String selectedType = type != null ? type.trim() : "";
        String titleKeyword = title != null ? title.trim() : "";
        String authorKeyword = author != null ? author.trim() : "";

        boolean hasSearch = !keyword.isEmpty();
        boolean hasType = !selectedType.isEmpty();
        boolean hasTitle = !titleKeyword.isEmpty();
        boolean hasAuthor = !authorKeyword.isEmpty();
        boolean hasAdvancedFilters = hasTitle || hasAuthor;

        int requestedPage = page == null || page < 1 ? 1 : page;
        int pageSize = bookDataRepository.defaultPageSize();

        int totalCount;
        List<?> books;

        if (hasAdvancedFilters) {
            totalCount = bookDataRepository.countBooksByFilters(titleKeyword, authorKeyword, selectedType);
            books = bookDataRepository.findBooksByFiltersOrderByCreatedDesc(titleKeyword, authorKeyword, selectedType, pageSize, (requestedPage - 1) * pageSize);
        } else {
            totalCount = hasSearch && hasType ? bookDataRepository.countSearchBooksByKeywordAndType(keyword, selectedType)
                    : hasSearch ? bookDataRepository.countSearchBooksByKeyword(keyword)
                    : hasType ? bookDataRepository.countBooksByType(selectedType)
                    : bookDataRepository.countAllBooks();
            int totalPagesForOffset = Math.max(1, (int) Math.ceil(totalCount / (double) pageSize));
            int currentPageForOffset = Math.min(requestedPage, totalPagesForOffset);
            int offsetForOffset = (currentPageForOffset - 1) * pageSize;
            books = hasSearch && hasType
                    ? bookDataRepository.searchBooksByKeywordAndType(keyword, selectedType, pageSize, offsetForOffset)
                    : hasSearch
                    ? bookDataRepository.searchBooksByKeywordOrderByVolumeDesc(keyword, pageSize, offsetForOffset)
                    : hasType
                    ? bookDataRepository.findAllBooksByTypeAndCreatedDesc(selectedType, pageSize, offsetForOffset)
                    : bookDataRepository.findAllBooksOrderByCreatedDesc(pageSize, offsetForOffset);
        }

        int totalPages = Math.max(1, (int) Math.ceil(totalCount / (double) pageSize));
        int currentPage = Math.min(requestedPage, totalPages);
        int offset = (currentPage - 1) * pageSize;

        if (hasAdvancedFilters) {
            books = bookDataRepository.findBooksByFiltersOrderByCreatedDesc(titleKeyword, authorKeyword, selectedType, pageSize, offset);
        }

        authSessionHelper.populateMember(model, session);
        model.addAttribute("search", keyword);
        model.addAttribute("type", selectedType);
        model.addAttribute("title", titleKeyword);
        model.addAttribute("author", authorKeyword);
        model.addAttribute("hasAdvancedFilters", hasAdvancedFilters);
        model.addAttribute("types", bookDataRepository.findAllBookTypes());
        model.addAttribute("books", books);
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
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

        authSessionHelper.populateMember(model, session);
        BookDetailViewModel vm = new BookDetailViewModel(
                book,
                bookVolumeRepository.findVolumesByBookId(id),
                bookDataRepository.findAllBookTypes()
        );
        model.addAttribute("vm", vm);
        model.addAttribute("book", vm.book());
        model.addAttribute("volumes", vm.volumes());
        model.addAttribute("bookTypes", vm.bookTypes());
        return "book_detail";
    }

    @PostMapping("/books/{id}")
    public String updateBook(@PathVariable int id,
                             @RequestParam(value = "name", required = false) String name,
                             @RequestParam(value = "author", required = false) String author,
                             @RequestParam(value = "description", required = false) String description,
                             @RequestParam(value = "cover", required = false) String cover,
                             @RequestParam(value = "type", required = false) String type,
                             @RequestParam(value = "totalvolume", required = false) String totalVolume,
                             HttpSession session,
                             RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

        bookDataRepository.updateBook(id, name, author, description, cover, type, totalVolume);
        redirectAttributes.addFlashAttribute("success", "책 정보를 수정했어요.");
        return "redirect:/books/" + id;
    }

    @PostMapping("/books/{id}/volumes/{volumeId}")
    public String updateVolume(@PathVariable int id,
                               @PathVariable int volumeId,
                               @RequestParam(value = "isbn13", required = false) String isbn13,
                               @RequestParam(value = "name", required = false) String name,
                               @RequestParam(value = "cover", required = false) String cover,
                               @RequestParam(value = "price", required = false) String price,
                               @RequestParam(value = "purchased", defaultValue = "false") boolean purchased,
                               @RequestParam(value = "seq", required = false) Integer seq,
                               @RequestParam(value = "type", required = false) String type,
                               HttpSession session,
                               RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

        bookVolumeRepository.updateVolume(id, volumeId, isbn13, name, cover, price, purchased, seq);
        if (type != null && !type.trim().isEmpty()) {
            bookDataRepository.updateBook(id, book.name(), book.author(), book.description(), book.cover(), type, book.totalvolume());
        }
        redirectAttributes.addFlashAttribute("success", "권 정보를 수정했어요.");
        return "redirect:/books/" + id;
    }

    @PostMapping("/books/{id}/delete")
    @Transactional
    public String deleteBook(@PathVariable int id, HttpSession session, RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

        bookVolumeRepository.deleteVolumesByBookId(id);
        bookDataRepository.deleteBookById(id);
        redirectAttributes.addFlashAttribute("success", "도서를 삭제했어요. (" + book.name() + ")");
        return "redirect:/books";
    }

    @PostMapping("/books/{id}/volumes/delete")
    @Transactional
    public String deleteVolumes(@PathVariable int id,
                                @RequestParam(value = "volumeIds", required = false) List<Integer> volumeIds,
                                HttpSession session,
                                RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";
        if (volumeIds == null || volumeIds.isEmpty()) {
            redirectAttributes.addFlashAttribute("error", "삭제할 권을 선택해 주세요.");
            return "redirect:/books/" + id;
        }

        bookVolumeRepository.deleteVolumesByBookAndIds(id, volumeIds);
        redirectAttributes.addFlashAttribute("success", volumeIds.size() + "개 권을 삭제했어요.");
        return "redirect:/books/" + id;
    }

    private int getStartPage(int currentPage, int totalPages) {
        int half = PAGE_LINK_WINDOW / 2;
        return Math.max(1, currentPage - half);
    }

    private int getEndPage(int currentPage, int totalPages) {
        int half = PAGE_LINK_WINDOW / 2;
        int end = currentPage + half;
        if (totalPages <= PAGE_LINK_WINDOW) return totalPages;
        if (end > totalPages) return totalPages;
        int start = getStartPage(currentPage, totalPages);
        int width = Math.min(PAGE_LINK_WINDOW, totalPages);
        return Math.min(totalPages, start + width - 1);
    }
}
