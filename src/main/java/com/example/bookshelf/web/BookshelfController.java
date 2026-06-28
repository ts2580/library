package com.example.bookshelf.web;

import com.example.bookshelf.user.service.BookCatalogService;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.web.viewmodel.BookDetailViewModel;
import com.example.bookshelf.web.viewmodel.BookListViewModel;
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

    private final BookCatalogService bookCatalogService;
    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;

    public BookshelfController(BookCatalogService bookCatalogService,
                               BookDataRepository bookDataRepository,
                               BookVolumeRepository bookVolumeRepository) {
        this.bookCatalogService = bookCatalogService;
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
    }

    @RequestMapping("/books")
    public String list(@RequestParam(value = "search", required = false) String search,
                       @RequestParam(value = "page", defaultValue = "1") Integer page,
                       @RequestParam(value = "type", required = false) String type,
                       @RequestParam(value = "title", required = false) String title,
                       @RequestParam(value = "author", required = false) String author,
                       Model model) {
        applyBookListModel(model, bookCatalogService.findBookList(search, type, title, author, page));
        return "book_list";
    }

    @PostMapping("/books")
    public String createBook(@RequestParam("name") String name,
                             @RequestParam(value = "author", required = false) String author,
                             @RequestParam(value = "description", required = false) String description,
                             @RequestParam(value = "cover", required = false) String cover,
                             @RequestParam(value = "type", required = false) String type,
                             @RequestParam(value = "totalvolume", required = false) String totalVolume,
                             RedirectAttributes redirectAttributes) {
        if (name == null || name.isBlank()) {
            redirectAttributes.addFlashAttribute("error", "책 제목을 입력해 주세요.");
            return "redirect:/books";
        }

        int bookId = bookDataRepository.insertBook(name, author, description, cover, type, totalVolume);
        redirectAttributes.addFlashAttribute("success", "책을 추가했습니다.");
        return "redirect:/books/" + bookId;
    }

    @GetMapping("/books/{id}")
    public String detail(@PathVariable int id, Model model) {
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

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
                             RedirectAttributes redirectAttributes) {
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

        bookDataRepository.updateBook(id, name, author, description, cover, type, totalVolume);
        redirectAttributes.addFlashAttribute("success", "책 정보를 수정했습니다.");
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
                               RedirectAttributes redirectAttributes) {
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

        bookVolumeRepository.updateVolume(id, volumeId, isbn13, name, cover, price, purchased, seq);
        if (type != null && !type.trim().isEmpty()) {
            bookDataRepository.updateBook(id, book.name(), book.author(), book.description(), book.cover(), type, book.totalvolume());
        }
        redirectAttributes.addFlashAttribute("success", "권 정보를 수정했습니다.");
        return "redirect:/books/" + id;
    }

    @PostMapping("/books/{id}/delete")
    @Transactional
    public String deleteBook(@PathVariable int id, RedirectAttributes redirectAttributes) {
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";

        bookVolumeRepository.deleteVolumesByBookId(id);
        bookDataRepository.deleteBookById(id);
        redirectAttributes.addFlashAttribute("success", "도서를 삭제했습니다. (" + book.name() + ")");
        return "redirect:/books";
    }

    @PostMapping("/books/{id}/volumes/delete")
    @Transactional
    public String deleteVolumes(@PathVariable int id,
                                @RequestParam(value = "volumeIds", required = false) List<Integer> volumeIds,
                                RedirectAttributes redirectAttributes) {
        var book = bookDataRepository.findBookById(id);
        if (book == null) return "redirect:/books";
        if (volumeIds == null || volumeIds.isEmpty()) {
            redirectAttributes.addFlashAttribute("error", "삭제할 권을 선택해 주세요.");
            return "redirect:/books/" + id;
        }

        bookVolumeRepository.deleteVolumesByBookAndIds(id, volumeIds);
        redirectAttributes.addFlashAttribute("success", volumeIds.size() + "개 권을 삭제했습니다.");
        return "redirect:/books/" + id;
    }

    private void applyBookListModel(Model model, BookListViewModel vm) {
        model.addAttribute("search", vm.search());
        model.addAttribute("type", vm.type());
        model.addAttribute("title", vm.title());
        model.addAttribute("author", vm.author());
        model.addAttribute("hasAdvancedFilters", vm.hasAdvancedFilters());
        model.addAttribute("types", vm.types());
        model.addAttribute("books", vm.books());
        model.addAttribute("page", vm.page().currentPage());
        model.addAttribute("pageSize", vm.page().pageSize());
        model.addAttribute("totalCount", vm.page().totalItems());
        model.addAttribute("totalPages", vm.page().totalPages());
        model.addAttribute("from", vm.page().from());
        model.addAttribute("to", vm.page().to());
        model.addAttribute("startPage", vm.page().startPage());
        model.addAttribute("endPage", vm.page().endPage());
    }
}
