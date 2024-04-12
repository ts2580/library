package com.proxy.library.stock.comtroller;

import com.proxy.library.stock.model.dto.StockBook;
import com.proxy.library.stock.model.service.StockService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.ArrayList;
import java.util.List;

@Controller
@RequiredArgsConstructor
public class StockHomeController {

    private final StockService stockService;

    @GetMapping("/")
    public String loginPage() {
        return "home_form";
    }
}



















