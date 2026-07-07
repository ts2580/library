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
    private final com.example.bookshelf.integration.aladin.AladinSearchService aladinSearchService;

    public BookshelfController(BookCatalogService bookCatalogService,
                               BookDataRepository bookDataRepository,
                               BookVolumeRepository bookVolumeRepository,
                               com.example.bookshelf.integration.aladin.AladinSearchService aladinSearchService) {
        this.bookCatalogService = bookCatalogService;
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.aladinSearchService = aladinSearchService;
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
    @Transactional
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

        com.example.bookshelf.integration.aladin.AladinSearchResult aladinResult = aladinSearchService.searchBookItems(name, 1);
        List<com.example.bookshelf.integration.aladin.AladinItem> items = aladinResult.items();
        
        if (items != null && !items.isEmpty()) {
            com.example.bookshelf.integration.aladin.AladinItem vol1 = items.stream()
                    .filter(item -> item.title() != null && item.title().contains("1권"))
                    .findFirst()
                    .orElse(items.get(0));
            if (cover == null || cover.isBlank()) cover = vol1.cover();
            if (description == null || description.isBlank()) description = vol1.description();
            if (author == null || author.isBlank()) author = vol1.author();
        }

        int bookId = bookDataRepository.insertBook(name, author, description, cover, type, totalVolume);

        if (items != null) {
            int seq = 1;
            for (com.example.bookshelf.integration.aladin.AladinItem item : items) {
                String isbn13 = item.isbn13();
                if (isbn13 == null || isbn13.isBlank()) isbn13 = item.isbn();
                if (isbn13 != null && !isbn13.isBlank() && !bookVolumeRepository.existsVolumeByIsbn13(isbn13)) {
                    bookVolumeRepository.insertVolume(bookId, seq++, isbn13, item.title(), item.cover(), item.priceSales());
                }
            }
        }

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
