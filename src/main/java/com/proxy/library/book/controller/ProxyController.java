package com.proxy.library.book.controller;

import com.proxy.library.book.model.dto.Book;
import com.proxy.library.book.model.service.ProxyService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;


import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.PostMapping;

import java.util.List;

@RestController
@RequiredArgsConstructor
public class ProxyController {

    private final ProxyService proxyService;
    @GetMapping("/library/book")
    public Book findBook() {

        Book objBook = proxyService.findBook();

        System.out.println(objBook);
        
        return objBook;
    }

    @PostMapping("/library/books")
    public String insertBooks(@RequestBody List<Book> paramBook) {

        int isrtBook = 0;
        String res = "삽입된 권 : ";

        try {
            isrtBook = proxyService.books(paramBook);
        }catch (Exception e){
            System.out.println(e.getMessage());
        }finally {
            res += isrtBook + "권";
        }

        return res;
    }
}
