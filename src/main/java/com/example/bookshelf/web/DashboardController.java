package com.example.bookshelf.web;

import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import com.example.bookshelf.user.service.ProductService;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import java.util.LinkedHashMap;
import java.util.Map;

@Controller
public class DashboardController {

    private final AuthSessionHelper authSessionHelper;
    private final BookVolumeRepository bookVolumeRepository;
    private final BranchInventoryRepository branchInventoryRepository;
    private final ProductService productService;

    public DashboardController(AuthSessionHelper authSessionHelper,
                               BookVolumeRepository bookVolumeRepository,
                               BranchInventoryRepository branchInventoryRepository,
                               ProductService productService) {
        this.authSessionHelper = authSessionHelper;
        this.bookVolumeRepository = bookVolumeRepository;
        this.branchInventoryRepository = branchInventoryRepository;
        this.productService = productService;
    }

    @GetMapping("/dashboard")
    public String dashboard(HttpSession session, Model model) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        authSessionHelper.populateMember(model, session);
        model.addAttribute("bookCount", bookVolumeRepository.countAllBookVolumes());
        return "dashboard";
    }

    @GetMapping("/")
    public String rootToDashboard(HttpSession session) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        return "redirect:/dashboard";
    }

    @GetMapping("/dashboard/branches")
    public String branchDashboard(HttpSession session, Model model) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";

        var branches = branchInventoryRepository.findBranchInventorySummaries();
        long totalAmount = branches.stream().mapToLong(s -> s.totalAmount()).sum();
        var updatedAt = branchInventoryRepository.findLatestBranchInventorySummaryUpdatedAt();

        authSessionHelper.populateMember(model, session);
        model.addAttribute("branches", branches);
        model.addAttribute("totalAmount", totalAmount);
        model.addAttribute("branchCount", branches.size());
        model.addAttribute("chartLabels", branches.stream().map(s -> s.branchName()).toList());
        model.addAttribute("chartBranches", branches.stream().map(s -> s.branch()).toList());
        model.addAttribute("chartValues", branches.stream().mapToLong(s -> s.totalAmount()).boxed().toList());
        model.addAttribute("summaryUpdatedAt", updatedAt);
        model.addAttribute("refreshProgress", productService.getStockRefreshProgress());
        return "branch_inventory_dashboard";
    }

    @PostMapping("/dashboard/branches/delete-all")
    public String deleteAllBranchStocks(HttpSession session, RedirectAttributes redirectAttributes) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";
        productService.deleteAllBranchInventory();
        redirectAttributes.addFlashAttribute("success", "지점 재고와 집계 테이블을 전체 삭제했어요.");
        return "redirect:/dashboard/branches";
    }

    @PostMapping("/dashboard/branches/refresh-stocks")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> startBranchStockRefresh(HttpSession session) {
        if (!authSessionHelper.isLoggedIn(session)) {
            return ResponseEntity.status(401).body(Map.of("message", "로그인이 필요해요."));
        }
        var result = productService.startStockRefreshJob();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("started", result.started());
        body.put("message", result.message());
        body.put("progress", result.progress());
        return ResponseEntity.ok(body);
    }

    @GetMapping("/dashboard/branches/refresh-progress")
    @ResponseBody
    public ResponseEntity<ProductService.StockRefreshProgress> branchStockRefreshProgress(HttpSession session) {
        if (!authSessionHelper.isLoggedIn(session)) return ResponseEntity.status(401).build();
        return ResponseEntity.ok(productService.getStockRefreshProgress());
    }

    @GetMapping("/dashboard/branches/{branch}")
    public String branchDetail(HttpSession session, @PathVariable("branch") String branch, Model model) {
        if (!authSessionHelper.isLoggedIn(session)) return "redirect:/user/login";

        var stocks = branchInventoryRepository.findStocksByBranch(branch);
        String branchName = stocks.isEmpty() ? branch : stocks.get(0).branchName();
        int totalCount = stocks.size();
        long pricedCount = stocks.stream().filter(s -> s.price() != null && !s.price().isBlank()).count();
        long totalAmount = stocks.stream().mapToLong(s -> parsePriceSafe(s.price())).sum();

        authSessionHelper.populateMember(model, session);
        model.addAttribute("branch", branch);
        model.addAttribute("branchName", branchName);
        model.addAttribute("stocks", stocks);
        model.addAttribute("totalCount", totalCount);
        model.addAttribute("pricedCount", pricedCount);
        model.addAttribute("totalAmount", totalAmount);
        return "branch_stock_list";
    }

    @GetMapping("/dashboard/branches/detail")
    public String branchDetailLegacy(HttpSession session, @RequestParam("branch") String branch, Model model) {
        return branchDetail(session, branch, model);
    }

    private long parsePriceSafe(String price) {
        if (price == null || price.isBlank()) return 0L;
        try {
            return Long.parseLong(price.replace(",", "").trim());
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
