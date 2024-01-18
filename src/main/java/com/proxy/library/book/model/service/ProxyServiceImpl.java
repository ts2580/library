package com.proxy.library.book.model.service;

import com.proxy.library.book.model.dto.Book;
import com.proxy.library.book.model.repository.ProxyRepository;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ProxyServiceImpl implements ProxyService {

    private final ProxyRepository proxyRepository;

    public Book findBook() {
        return proxyRepository.findBook();
		
	}
    

}
