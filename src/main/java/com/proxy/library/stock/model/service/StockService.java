package com.proxy.library.stock.model.service;

import com.proxy.library.stock.model.dto.StockBook;

import java.util.List;

public interface StockService {

    List<StockBook> getStock(String name);

    List<StockBook> getBranchBook(String branch);
}
