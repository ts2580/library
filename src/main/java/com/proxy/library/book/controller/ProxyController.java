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

    @GetMapping("/library/bookbyvolumes/target")
    public List<BookByVolume> getTargetBook(){

        List<BookByVolume> returnBook = new ArrayList<>();

        try {
            returnBook = proxyService.getTargetBook();
        }catch (Exception e){
            System.out.println(e.getMessage());
        }

        return returnBook;

    }

    @DeleteMapping("/library/bookbyvolumes/target")
    public String delTargetBook(){

        String res = "";

        try {
            proxyService.delBooks();
            res = "싹 날림";
        }catch (Exception e){
            System.out.println(e.getMessage());
            res = "삭제 실패";
        }

        return res;
    }

    @PutMapping("/library/bookbyvolumes/pric")
    public String updtBookPrc() {

        String res = "";

        try {
            proxyService.updtBookPrc();
            res = "가격 업데이트 성공";
        }catch (Exception e){
            System.out.println(e.getMessage());
            res = "가격 업데이트 실패 흑흑";
        }

        return res;
    }

    @PostMapping("/library/branchBook")
    public String setBookStockByBranch(@RequestBody List<Branchbook> paramBooks) {

        int isrtBook = 0;
        String res = "삽입된 권 : ";

        System.out.println(paramBooks);

        try {
            isrtBook = proxyService.setBookStockByBranch(paramBooks);

        }catch (Exception e){
            System.out.println(e.getMessage());
        }finally {
            res += isrtBook + "권";
        }

        return res;
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



















