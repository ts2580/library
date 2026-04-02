package com.example.bookshelf.web;

import com.example.bookshelf.integration.aladin.AladinApiService;
import com.example.bookshelf.integration.aladin.AladinSearchResult;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.service.ProductService;
import com.example.bookshelf.web.viewmodel.ProductSearchViewModel;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Controller
public class ProductController {

    private static final int PAGE_SIZE = 20;
    private static final int PAGE_SIZE_MOBILE = 10;

    private final AuthSessionHelper authSessionHelper;
    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;
    private final AladinApiService aladinApiService;
    private final ProductService productService;

    public ProductController(AuthSessionHelper authSessionHelper,
                             BookDataRepository bookDataRepository,
                             BookVolumeRepository bookVolumeRepository,
                             AladinApiService aladinApiService,
                             ProductService productService) {
        this.authSessionHelper = authSessionHelper;
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.aladinApiService = aladinApiService;
        this.productService = productService;
    }

    @GetMapping("/products")
    public String products(HttpSession session,
                           @RequestParam(value = "ownedQ", required = false) String ownedQ,
                           @RequestParam(value = "q", required = false) String q,
                           @RequestParam(value = "tab", required = false) String tab,
                           @RequestParam(value = "ownedPage", defaultValue = "1") Integer ownedPage,
                           @RequestParam(value = "aladinPage", defaultValue = "1") Integer aladinPage,
                           @RequestParam(value = "ownedSort", defaultValue = "id") String ownedSort,
                           @RequestHeader(value = "User-Agent", required = false) String userAgent,
                           Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        authSessionHelper.populateMember(model, session);
        int pageSize = resolvePageSize(userAgent);
        ProductSearchViewModel vm = buildViewModel(ownedQ, q, ownedPage, aladinPage, ownedSort, pageSize);
        applyViewModel(model, vm);
        model.addAttribute("activeTab", normalizeTab(tab));

        if (vm.ownedPage() != clampPage(ownedPage) || vm.aladinPage() != clampPage(aladinPage)) {
            return buildRedirect(vm.ownedQ(), vm.query(), vm.ownedPage(), vm.aladinPage(), vm.ownedSort(), normalizeTab(tab));
        }
        return "product_search";
    }

    @GetMapping("/products/books/autocomplete")
    @ResponseBody
    public ResponseEntity<List<Map<String, Object>>> autocompleteBooks(HttpSession session,
                                                                       @RequestParam("q") String q) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return ResponseEntity.status(401).build();
        }
        String keyword = q == null ? "" : q.trim();
        if (keyword.isEmpty()) {
            return ResponseEntity.ok(List.of());
        }

        var books = bookDataRepository.searchBooksByKeywordOrderByVolumeDesc(keyword, 8, 0);
        if (books.isEmpty()) {
            books = bookDataRepository.searchBooksByKeywordFallback(keyword, 8, 0);
        }
        var payload = books.stream().map(book -> Map.<String, Object>of(
                "id", book.id(),
                "name", book.name(),
                "author", book.author() == null ? "" : book.author(),
                "type", book.type() == null ? "" : book.type(),
                "totalvolume", book.totalvolume() == null ? "" : book.totalvolume(),
                "createddate", book.createddate() == null ? "" : book.createddate()
        )).toList();
        return ResponseEntity.ok(payload);
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
                                @RequestParam(value = "volume", required = false) Integer volume,
                                @RequestParam(value = "type", required = false) String type,
                                @RequestParam(value = "totalVolume", required = false) String totalVolume,
                                @RequestParam(value = "tab", required = false) String tab,
                                @RequestParam(value = "ownedQ", required = false) String ownedQ,
                                @RequestParam(value = "q", required = false) String q,
                                @RequestParam(value = "ownedPage", defaultValue = "1") int ownedPage,
                                @RequestParam(value = "aladinPage", defaultValue = "1") int aladinPage,
                                @RequestParam(value = "ownedSort", defaultValue = "id") String ownedSort,
                                HttpSession session,
                                RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        var result = productService.importProduct(new ProductService.ProductImportCommand(
                title, author, cover, isbn13, isbn, price, description, targetBookId, volume, type, totalVolume
        ));
        redirectAttributes.addFlashAttribute(result.success() ? "success" : "error", result.message());
        return buildRedirect(ownedQ, q, ownedPage, aladinPage, ownedSort, normalizeTab(tab));
    }

    private ProductSearchViewModel buildViewModel(String ownedQ, String q, Integer ownedPage, Integer aladinPage, String ownedSort, int pageSize) {
        String oq = ownedQ != null ? ownedQ.trim() : "";
        String aq = q != null ? q.trim() : "";
        int requestedOwnedPage = clampPage(ownedPage);
        int requestedAladinPage = clampPage(aladinPage);

        int totalOwned = oq.isEmpty() ? bookVolumeRepository.countAllBookVolumes() : bookVolumeRepository.countVolumeSearchByKeyword(oq);
        int ownedOffset = (requestedOwnedPage - 1) * pageSize;
        List<BookVolume> ownedVolumes = oq.isEmpty()
                ? bookVolumeRepository.findAllVolumesOrderByIdDesc(pageSize, ownedOffset)
                : bookVolumeRepository.searchVolumesByKeyword(oq, pageSize, ownedOffset);

        AladinSearchResult aladinResult = aq.isEmpty()
                ? new AladinSearchResult(new ArrayList<>(), 0, requestedAladinPage, pageSize)
                : aladinApiService.searchBookItems(aq, requestedAladinPage);

        return ProductSearchViewModel.of(
                oq,
                aq,
                ownedSort == null ? "id" : ownedSort,
                pageSize,
                bookDataRepository.findAllBookTypes(),
                ownedVolumes,
                bookDataRepository.findAllBooks(),
                requestedOwnedPage,
                totalOwned,
                requestedAladinPage,
                aladinResult.items(),
                aladinResult.totalResults()
        );
    }

    private int resolvePageSize(String userAgent) {
        if (isMobileUserAgent(userAgent)) {
            return PAGE_SIZE_MOBILE;
        }
        return PAGE_SIZE;
    }

    private boolean isMobileUserAgent(String userAgent) {
        if (userAgent == null) {
            return false;
        }
        return userAgent.contains("Mobi")
                || userAgent.contains("Android")
                || userAgent.contains("iPhone")
                || userAgent.contains("iPod")
                || userAgent.contains("Mobile");
    }

    private void applyViewModel(Model model, ProductSearchViewModel vm) {
        model.addAttribute("ownedQ", vm.ownedQ());
        model.addAttribute("query", vm.query());
        model.addAttribute("ownedSort", vm.ownedSort());
        model.addAttribute("pageSize", vm.pageSize());
        model.addAttribute("bookTypes", vm.bookTypes());
        model.addAttribute("ownedVolumes", vm.ownedVolumes());
        model.addAttribute("ownedBooks", vm.ownedBooks());
        model.addAttribute("ownedPage", vm.ownedPage());
        model.addAttribute("ownedFrom", vm.ownedFrom());
        model.addAttribute("ownedTo", vm.ownedTo());
        model.addAttribute("totalOwned", vm.totalOwned());
        model.addAttribute("totalOwnedPages", vm.totalOwnedPages());
        model.addAttribute("ownedStartPage", vm.ownedStartPage());
        model.addAttribute("ownedEndPage", vm.ownedEndPage());
        model.addAttribute("aladinPage", vm.aladinPage());
        model.addAttribute("aladinResults", vm.aladinResults());
        model.addAttribute("totalAladinResults", vm.totalAladinResults());
        model.addAttribute("totalAladinPages", vm.totalAladinPages());
        model.addAttribute("aladinFrom", vm.aladinFrom());
        model.addAttribute("aladinTo", vm.aladinTo());
        model.addAttribute("aladinStartPage", vm.aladinStartPage());
        model.addAttribute("aladinEndPage", vm.aladinEndPage());
    }

    private String buildRedirect(String ownedQ, String q, int ownedPage, int aladinPage, String ownedSort, String tab) {
        StringBuilder query = new StringBuilder("/products?");
        query.append("ownedPage=").append(ownedPage > 0 ? ownedPage : 1)
                .append("&aladinPage=").append(aladinPage > 0 ? aladinPage : 1)
                .append("&ownedSort=").append(ownedSort == null ? "id" : ownedSort)
                .append("&tab=").append(normalizeTab(tab));
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

    private String normalizeTab(String tab) {
        return "aladin".equalsIgnoreCase(tab) ? "aladin" : "owned";
    }
}
