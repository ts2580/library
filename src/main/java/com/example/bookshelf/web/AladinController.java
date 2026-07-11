package com.example.bookshelf.web;

import com.example.bookshelf.integration.aladin.AladinSearchOptions;
import com.example.bookshelf.integration.aladin.AladinSearchService;
import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import org.springframework.stereotype.Controller;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class AladinController {

    private final AladinSearchService aladinSearchService;
    private final AladinUsedStockService aladinUsedStockService;
    private final AuthSessionHelper authSessionHelper;

    @Autowired
    public AladinController(AladinSearchService aladinSearchService,
                            AladinUsedStockService aladinUsedStockService,
                            AuthSessionHelper authSessionHelper) {
        this.aladinSearchService = aladinSearchService;
        this.aladinUsedStockService = aladinUsedStockService;
        this.authSessionHelper = authSessionHelper;
    }

    public AladinController(AladinSearchService aladinSearchService,
                            AladinUsedStockService aladinUsedStockService) {
        this(aladinSearchService, aladinUsedStockService, null);
    }

    @GetMapping("/aladin/search")
    public String search(@RequestParam(value = "query", required = false) String query,
                         @RequestParam(value = "queryType", required = false) String queryType,
                         @RequestParam(value = "searchTarget", required = false) String searchTarget,
                         @RequestParam(value = "sort", required = false) String sort,
                         @RequestParam(value = "cover", required = false) String cover,
                         @RequestParam(value = "maxResults", required = false) Integer maxResults,
                         @RequestParam(value = "start", required = false) Integer start,
                         @RequestParam(value = "categoryId", required = false) Integer categoryId,
                         @RequestParam(value = "recentPublishFilter", required = false) Integer recentPublishFilter,
                         @RequestParam(value = "outOfStockFilter", required = false, defaultValue = "false") boolean outOfStockFilter,
                         Model model) {
        AladinSearchOptions options = AladinSearchOptions.of(
                query,
                queryType,
                searchTarget,
                sort,
                cover,
                maxResults,
                start,
                categoryId,
                recentPublishFilter,
                outOfStockFilter
        );
        model.addAttribute("options", options);
        model.addAttribute("query", options.query());

        if (!options.query().isBlank()) {
            Integer ownerId = authSessionHelper == null ? null : authSessionHelper.getMemberId(null);
            model.addAttribute("searchView", aladinSearchService.searchBookView(options, ownerId));
        }
        return "aladin_search";
    }

    @GetMapping("/aladin/used")
    public String used(@RequestParam("isbn13") String isbn13,
                       @RequestParam(value = "type", required = false, defaultValue = "dropshipping") String type,
                       Model model) {
        model.addAttribute("isbn13", isbn13);
        model.addAttribute("type", type);
        model.addAttribute("usedView", aladinUsedStockService.usedBookView(isbn13, type));
        return "aladin_used_search";
    }
}
