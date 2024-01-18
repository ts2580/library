package com.proxy.library.book.controller;

import com.proxy.library.book.model.dto.Book;
import com.proxy.library.book.model.service.ProxyService;
import org.springframework.web.bind.annotation.RestController;


import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.PostMapping;

@RestController
@RequiredArgsConstructor
public class ProxyController {

    private final ProxyService proxyService;
    @PostMapping("/book")
    public Book findAllBooks() {

        Book objBook = proxyService.findBook();

        System.out.println(objBook);
        
        return objBook;
    }
    


}
