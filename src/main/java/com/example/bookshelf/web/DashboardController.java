package com.example.bookshelf.web;

import com.example.bookshelf.user.repository.BookRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class DashboardController {

    private final AuthSessionHelper authSessionHelper;
    private final BookRepository bookRepository;

    public DashboardController(AuthSessionHelper authSessionHelper, BookRepository bookRepository) {
        this.authSessionHelper = authSessionHelper;
        this.bookRepository = bookRepository;
    }

    @GetMapping("/dashboard")
    public String dashboard(HttpSession session, Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        authSessionHelper.populateMember(model, session);
        model.addAttribute("bookCount", bookRepository.countAllBookVolumes());
        return "dashboard";
    }

    @GetMapping("/")
    public String rootToDashboard(HttpSession session) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }
        return "redirect:/dashboard";
    }

    @GetMapping("/dashboard/branches")
    public String branchDashboard(HttpSession session, Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        var branches = bookRepository.findBranchInventorySummaries();
        long totalAmount = branches.stream().mapToLong(s -> s.totalAmount()).sum();

        authSessionHelper.populateMember(model, session);
        model.addAttribute("branches", branches);
        model.addAttribute("totalAmount", totalAmount);
        model.addAttribute("branchCount", branches.size());
        model.addAttribute("chartLabels", toJsonArray(branches.stream().map(s -> s.branchName()).toList()));
        model.addAttribute("chartValues", toJsonArray(branches.stream().mapToLong(s -> s.totalAmount()).toArray()));

        return "branch_inventory_dashboard";
    }

    @GetMapping("/dashboard/branches/detail")
    public String branchDetail(HttpSession session,
                               @RequestParam("branch") String branch,
                               Model model) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return "redirect:/user/login";
        }

        var stocks = bookRepository.findStocksByBranch(branch);

        String branchName = stocks.isEmpty() ? branch : stocks.get(0).branchName();
        int totalCount = stocks.size();
        long pricedCount = stocks.stream().filter(s -> s.price() != null && !s.price().isBlank()).count();
        long totalAmount = stocks.stream()
                .mapToLong(s -> parsePriceSafe(s.price()))
                .sum();

        authSessionHelper.populateMember(model, session);
        model.addAttribute("branch", branch);
        model.addAttribute("branchName", branchName);
        model.addAttribute("stocks", stocks);
        model.addAttribute("totalCount", totalCount);
        model.addAttribute("pricedCount", pricedCount);
        model.addAttribute("totalAmount", totalAmount);

        return "branch_stock_list";
    }

    private String toJsonArray(java.util.Collection<String> values) {
        if (values == null || values.isEmpty()) {
            return "[]";
        }
        return values.stream()
                .map(v -> "\"" + java.util.Objects.toString(v, "").replace("\\", "\\\\").replace("\"", "\\\"") + "\"")
                .collect(java.util.stream.Collectors.joining(",", "[", "]"));
    }

    private String toJsonArray(long[] values) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < values.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(values[i]);
        }
        sb.append(']');
        return sb.toString();
    }

    private long parsePriceSafe(String price) {
        if (price == null || price.isBlank()) {
            return 0L;
        }
        try {
            return Long.parseLong(price.replace(",", "").trim());
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
