package com.proxy.library.book.controller;

import com.proxy.library.book.model.dto.Book;
import com.proxy.library.book.model.dto.BookByVolume;
import com.proxy.library.book.model.dto.Branchbook;
import com.proxy.library.book.model.service.ProxyService;
import org.springframework.web.bind.annotation.*;


import lombok.RequiredArgsConstructor;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
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

    @GetMapping("/library/bookbyvolume/info")
    public List<BookByVolume> getBookByVolume(@RequestParam(value = "title") String name) throws UnsupportedEncodingException {

        List<BookByVolume> returnBook = new ArrayList<>();

        try {
            returnBook = proxyService.getBookByVolume(name);
        }catch (Exception e){
            System.out.println(e.getMessage());
        }

        return returnBook;
    }

    @PostMapping("/library/bookbyvolumes")
    public String insertBookByVolume(@RequestBody List<BookByVolume> paramBook) {

        int isrtBook = 0;
        String res = "삽입된 권 : ";

        try {
            isrtBook = proxyService.insertBookByVolumes(paramBook);
        }catch (Exception e){
            System.out.println(e.getMessage());
        }finally {
            res += isrtBook + "권";
        }

        return res;
    }

    @PutMapping("/library/bookbyvolumes")
    public String updtBookByVolume(@RequestBody List<BookByVolume> paramBook) {

        int isrtBook = 0;
        String res = "업데이트된 권 : ";

        System.out.println(paramBook);

        try {
            isrtBook = proxyService.updtBookByVolume(paramBook);
        }catch (Exception e){
            System.out.println(e.getMessage());
        }finally {
            res += isrtBook + "권";
        }

        return res;
    }

    @GetMapping("/library/bookbyvolumes/latest")
    public List<BookByVolume> getBookByVolumeNew(){

        List<BookByVolume> returnBook = new ArrayList<>();

        try {
            returnBook = proxyService.getBookByVolumeNew();
        }catch (Exception e){
            System.out.println(e.getMessage());
        }

        return returnBook;

    }

    @PostMapping("/library/books")
    public String insertBooks(@RequestBody List<Book> paramBook) {

        int isrtBook = 0;
        String res = "삽입된 권 : ";

        try {
            isrtBook = proxyService.insertBooks(paramBook);
        }catch (Exception e){
            System.out.println(e.getMessage());
        }finally {
            res += isrtBook + "권";
        }

        return res;
    }



    @PostMapping("/aladin/usedbooks")
    public String insertUsedBooks(@RequestBody List<Branchbook> paramBook) {

        int isrtBook = 0;
        String res = "삽입된 권 : ";

        try {
            isrtBook = proxyService.insertStock(paramBook);
        }catch (Exception e){
            System.out.println(e.getMessage());
        }finally {
            res += isrtBook + "권";
        }

        return res;
    }
}



















