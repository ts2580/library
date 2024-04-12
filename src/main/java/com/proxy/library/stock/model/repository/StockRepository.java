package com.proxy.library.stock.model.repository;

import com.proxy.library.stock.model.dto.StockBook;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface StockRepository {
    List<StockBook> getStock(String name);
}
