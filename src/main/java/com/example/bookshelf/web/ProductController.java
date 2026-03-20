package com.example.bookshelf.web;

import com.example.bookshelf.integration.aladin.AladinSearchResult;
import com.example.bookshelf.user.repository.BookRepository;
import com.example.bookshelf.user.service.ProductService;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@Controller
public class ProductController {

    private static final Logger log = LoggerFactory.getLogger(ProductController.class);
    private static final int PAGE_SIZE = 20;
    private static final int PAGE_LINK_WINDOW = 5;

    private final AuthSessionHelper authSessionHelper;
    private final BookRepository bookRepository;
    private final com.example.bookshelf.integration.aladin.AladinApiService aladinApiService;
    private final ProductService productService;

    public ProductController(AuthSessionHelper authSessionHelper,
                             BookRepository bookRepository,
                             com.example.bookshelf.integration.aladin.AladinApiService aladinApiService,
                             ProductService productService) {
        this.authSessionHelper = authSessionHelper;
        this.bookRepository = bookRepository;
        this.aladinApiService = aladinApiService;
        this.productService = productService;
    }

    @GetMapping("/products")
    public String products(HttpSession session,
                           @RequestParam(value = "ownedQ", required = false) String ownedQ,
                           @RequestParam(value = "q", required = false) String q,
                           @RequestParam(value = "ownedPage", defaultValue = "1") Integer ownedPage,
                           @RequestParam(value = "aladinPage", defaultValue = "1") Integer aladinPage,
                           @RequestParam(value = "ownedSort", defaultValue = "volume") String ownedSort,
                           Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        authSessionHelper.populateMember(model, session);

        String oq = ownedQ != null ? ownedQ.trim() : "";
        String aq = q != null ? q.trim() : "";
        int requestedOwnedPage = clampPage(ownedPage);
        int requestedAladinPage = clampPage(aladinPage);

        log.info("[products] request q='{}', ownedQ='{}', ownedPage={}, aladinPage={}, ownedSort='{}'", aq, oq, requestedOwnedPage, requestedAladinPage, ownedSort);

        model.addAttribute("ownedQ", oq);
        model.addAttribute("query", aq);
        model.addAttribute("ownedSort", ownedSort);
        model.addAttribute("pageSize", PAGE_SIZE);

        int totalOwned = oq.isEmpty() ? bookRepository.countAllBooks() : bookRepository.countSearchBooksByKeyword(oq);
        int totalOwnedPages = Math.max(1, (int) Math.ceil(totalOwned / (double) PAGE_SIZE));
        int currentOwnedPage = Math.min(requestedOwnedPage, totalOwnedPages);
        int ownedOffset = (currentOwnedPage - 1) * PAGE_SIZE;

        List<com.example.bookshelf.user.model.Book> ownedBooks = loadOwnedBooks(oq, ownedSort, ownedOffset);
        model.addAttribute("ownedBooks", ownedBooks);
        model.addAttribute("ownedPage", currentOwnedPage);
        model.addAttribute("ownedFrom", totalOwned == 0 ? 0 : ownedOffset + 1);
        model.addAttribute("ownedTo", Math.min(currentOwnedPage * PAGE_SIZE, totalOwned));
        model.addAttribute("totalOwned", totalOwned);
        model.addAttribute("totalOwnedPages", totalOwnedPages);
        model.addAttribute("ownedStartPage", getStartPage(currentOwnedPage, totalOwnedPages));
        model.addAttribute("ownedEndPage", getEndPage(currentOwnedPage, totalOwnedPages));

        log.info("[products] owned results totalOwned={}, ownedBooks.size={}", totalOwned, ownedBooks.size());

        AladinSearchResult aladinResult = (!aq.isEmpty())
                ? aladinApiService.searchBookItems(aq, requestedAladinPage)
                : new AladinSearchResult(new ArrayList<>(), 0, requestedAladinPage, PAGE_SIZE);

        int totalAladinPages = Math.max(1, (int) Math.ceil(aladinResult.totalResults() / (double) PAGE_SIZE));
        int currentAladinPage = Math.min(requestedAladinPage, totalAladinPages);

        model.addAttribute("aladinPage", currentAladinPage);
        model.addAttribute("aladinResults", aladinResult.items());
        model.addAttribute("totalAladinResults", aladinResult.totalResults());
        model.addAttribute("totalAladinPages", totalAladinPages);
        model.addAttribute("aladinFrom", aladinResult.totalResults() == 0 ? 0 : ((currentAladinPage - 1) * PAGE_SIZE) + 1);
        model.addAttribute("aladinTo", Math.min(currentAladinPage * PAGE_SIZE, aladinResult.totalResults()));
        model.addAttribute("aladinStartPage", getStartPage(currentAladinPage, totalAladinPages));
        model.addAttribute("aladinEndPage", getEndPage(currentAladinPage, totalAladinPages));

        log.info("[products] aladin results totalAladinResults={}, items.size={}", aladinResult.totalResults(), aladinResult.items().size());
        if (!aladinResult.items().isEmpty()) {
            var first = aladinResult.items().get(0);
            log.info("[products] first aladin item title='{}', author='{}', isbn13='{}'", first.title(), first.author(), first.isbn13());
        }

        if (currentOwnedPage != requestedOwnedPage || currentAladinPage != requestedAladinPage) {
            return buildRedirect(oq, aq, currentOwnedPage, currentAladinPage, ownedSort);
        }

        return "product_search";
    }

    @PostMapping("/products/import")
    public String importProduct(@RequestParam("title") String title,
                                @RequestParam(value = "author", required = false) String author,
                                @RequestParam(value = "cover", required = false) String cover,
                                @RequestParam(value = "isbn13", required = false) String isbn13,
                                @RequestParam(value = "isbn", required = false) String isbn,
                                @RequestParam(value = "price", required = false) String price,
                                @RequestParam(value = "description", required = false) String description,
                                @RequestParam(value = "targetBookId", required = false) Integer targetBookId,
                                @RequestParam(value = "ownedQ", required = false) String ownedQ,
                                @RequestParam(value = "q", required = false) String q,
                                @RequestParam(value = "ownedPage", defaultValue = "1") int ownedPage,
                                @RequestParam(value = "aladinPage", defaultValue = "1") int aladinPage,
                                @RequestParam(value = "ownedSort", defaultValue = "volume") String ownedSort,
                                HttpSession session,
                                RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        var result = productService.importProduct(new ProductService.ProductImportCommand(
                title,
                author,
                cover,
                isbn13,
                isbn,
                price,
                description,
                targetBookId
        ));

        redirectAttributes.addFlashAttribute(result.success() ? "success" : "error", result.message());
        return buildRedirect(ownedQ, q, ownedPage, aladinPage, ownedSort);
    }

    @PostMapping("/products/refresh-stocks")
    public String refreshAllStocks(HttpSession session, RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        var result = productService.refreshAllStocks();
        redirectAttributes.addFlashAttribute("success", result.message());
        return "redirect:/products";
    }

    private List<com.example.bookshelf.user.model.Book> loadOwnedBooks(String ownedQuery, String ownedSort, int offset) {
        if (!ownedQuery.isEmpty()) {
            return bookRepository.searchBooksByKeywordOrderByVolumeDesc(ownedQuery, PAGE_SIZE, offset);
        }
        if ("recent".equalsIgnoreCase(ownedSort)) {
            return bookRepository.findAllBooksOrderByCreatedDesc(PAGE_SIZE, offset);
        }
        return bookRepository.findAllBooksOrderByVolumeDesc(PAGE_SIZE, offset);
    }

    private String buildRedirect(String ownedQ, String q, int ownedPage, int aladinPage, String ownedSort) {
        StringBuilder query = new StringBuilder("/products?");
        query.append("ownedPage=").append(ownedPage > 0 ? ownedPage : 1)
                .append("&aladinPage=").append(aladinPage > 0 ? aladinPage : 1)
                .append("&ownedSort=").append(ownedSort == null ? "volume" : ownedSort);

        if (ownedQ != null && !ownedQ.trim().isEmpty()) {
            query.append("&ownedQ=").append(urlEncode(ownedQ));
        }
        if (q != null && !q.trim().isEmpty()) {
            query.append("&q=").append(urlEncode(q));
        }
        return "redirect:" + query;
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private int clampPage(Integer page) {
        return page == null || page < 1 ? 1 : page;
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
