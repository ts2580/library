package com.example.bookshelf.web;

import com.example.bookshelf.user.service.ProductSearchService;
import com.example.bookshelf.user.service.ProductService;
import com.example.bookshelf.web.viewmodel.ProductSearchViewModel;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

@Controller
public class ProductController {

    private final AuthSessionHelper authSessionHelper;
    private final ProductSearchService productSearchService;
    private final ProductService productService;

    public ProductController(AuthSessionHelper authSessionHelper,
                             ProductSearchService productSearchService,
                             ProductService productService) {
        this.authSessionHelper = authSessionHelper;
        this.productSearchService = productSearchService;
        this.productService = productService;
    }

    @GetMapping("/products")
    public String products(@RequestParam(value = "ownedQ", required = false) String ownedQ,
                           @RequestParam(value = "q", required = false) String q,
                           @RequestParam(value = "tab", required = false) String tab,
                           @RequestParam(value = "ownedPage", defaultValue = "1") Integer ownedPage,
                           @RequestParam(value = "aladinPage", defaultValue = "1") Integer aladinPage,
                           @RequestParam(value = "ownedSort", defaultValue = "id") String ownedSort,
                           @RequestHeader(value = "User-Agent", required = false) String userAgent,
                           Model model) {
        ProductSearchViewModel vm = productSearchService.search(new ProductSearchService.ProductSearchRequest(
                ownedQ, q, ownedPage, aladinPage, ownedSort, userAgent
        ));
        if (vm.ownedPage() != clampPage(ownedPage) || vm.aladinPage() != clampPage(aladinPage)) {
            return buildRedirect(vm.ownedQ(), vm.query(), vm.ownedPage(), vm.aladinPage(), vm.ownedSort(), normalizeTab(tab));
        }

        applyViewModel(model, vm);
        model.addAttribute("activeTab", "aladin");
        return "product_search";
    }

    @GetMapping("/products/books/autocomplete")
    @ResponseBody
    public ResponseEntity<List<ProductSearchService.BookAutocompleteItem>> autocompleteBooks(HttpSession session,
                                                                                             @RequestParam("q") String q) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return ResponseEntity.status(401).build();
        }
        return ResponseEntity.ok(productSearchService.autocompleteBooks(q));
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
                                RedirectAttributes redirectAttributes) {
        var result = productService.importProduct(new ProductService.ProductImportCommand(
                title, author, cover, isbn13, isbn, price, description, targetBookId, volume, type, totalVolume
        ));
        redirectAttributes.addFlashAttribute(result.success() ? "success" : "error", result.message());
        return buildRedirect(ownedQ, q, ownedPage, aladinPage, ownedSort, normalizeTab(tab));
    }

    private void applyViewModel(Model model, ProductSearchViewModel vm) {
        model.addAttribute("ownedQ", vm.ownedQ());
        model.addAttribute("query", vm.query());
        model.addAttribute("ownedSort", vm.ownedSort());
        model.addAttribute("pageSize", vm.pageSize());
        model.addAttribute("bookTypes", vm.bookTypes());
        model.addAttribute("ownedVolumes", vm.ownedVolumes());
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
                .append("&ownedSort=").append(normalizeOwnedSort(ownedSort))
                .append("&tab=aladin");
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
        return "aladin";
    }

    private String normalizeOwnedSort(String sort) {
        return "recent".equalsIgnoreCase(sort) ? "recent" : "id";
    }
}
