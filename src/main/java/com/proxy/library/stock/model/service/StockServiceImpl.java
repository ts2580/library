package com.proxy.library.stock.model.service;

import com.proxy.library.stock.model.dto.StockBook;
import com.proxy.library.stock.model.repository.StockRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class StockServiceImpl implements StockService{

    private final StockRepository stockRepository;

    @Override
    public List<StockBook> getStock(String name) {
        return stockRepository.getStock(name);
    }
}
