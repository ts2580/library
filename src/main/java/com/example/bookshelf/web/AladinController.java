package com.example.bookshelf.web;

import com.example.bookshelf.integration.aladin.AladinApiService;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class AladinController {

    private final AuthSessionHelper authSessionHelper;
    private final AladinApiService aladinApiService;

    public AladinController(AuthSessionHelper authSessionHelper,
                            AladinApiService aladinApiService) {
        this.authSessionHelper = authSessionHelper;
        this.aladinApiService = aladinApiService;
    }

    @GetMapping("/aladin/search")
    public String search(@RequestParam(value = "query", required = false) String query,
                         HttpSession session,
                         Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        authSessionHelper.populateMember(model, session);
        model.addAttribute("query", query != null ? query : "");

        if (query != null && !query.trim().isEmpty()) {
            model.addAttribute("searchView", aladinApiService.searchBookView(query.trim()));
        }
        return "aladin_search";
    }

    @GetMapping("/aladin/used")
    public String used(@RequestParam("isbn13") String isbn13,
                       @RequestParam(value = "type", required = false, defaultValue = "dropshipping") String type,
                       HttpSession session,
                       Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        authSessionHelper.populateMember(model, session);
        model.addAttribute("isbn13", isbn13);
        model.addAttribute("type", type);
        model.addAttribute("usedView", aladinApiService.usedBookView(isbn13, type));
        return "aladin_used_search";
    }
}
