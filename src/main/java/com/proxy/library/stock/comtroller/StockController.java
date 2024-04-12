package com.proxy.library.stock.comtroller;

import com.proxy.library.stock.model.dto.StockBook;
import com.proxy.library.stock.model.service.StockService;
import lombok.RequiredArgsConstructor;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequiredArgsConstructor
public class StockController {

    private final StockService stockService;

    @GetMapping("/bookshelf/search")
    public List<StockBook> getBookByVolume(@RequestParam(value = "title") String name, Model model) {

        List<StockBook> returnBook = new ArrayList<>();

        try {
            returnBook = stockService.getStock(name);
        }catch (Exception e){
            System.out.println(e.getMessage());
        }

        return returnBook;
    }
}



















