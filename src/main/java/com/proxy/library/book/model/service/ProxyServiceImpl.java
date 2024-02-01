package com.proxy.library.book.model.service;

import com.proxy.library.book.model.dto.Book;
import com.proxy.library.book.model.dto.BookByVolume;
import com.proxy.library.book.model.dto.Branchbook;
import com.proxy.library.book.model.repository.ProxyRepository;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ProxyServiceImpl implements ProxyService {

    private final ProxyRepository proxyRepository;

    public Book findBook() {
        return proxyRepository.findBook();
	}

    public List<BookByVolume> getBookByVolume(String title){
        return proxyRepository.getBookByVolume(title);
    }

    public int insertBooks(List<Book> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.insertBooks(mapBooks);
    }

    public int insertBookByVolumes(List<BookByVolume> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.insertBookByVolumes(mapBooks);
    }

    public int updtBookByVolume(List<BookByVolume> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.updtBookByVolume(mapBooks);
    }

    public List<BookByVolume> getBookByVolumeNew(){
        return proxyRepository.getBookByVolumeNew();
    }

    public int insertStock(List<Branchbook> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.insertStock(mapBooks);
    }
    

}
