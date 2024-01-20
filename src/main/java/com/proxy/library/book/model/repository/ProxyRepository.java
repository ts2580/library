package com.proxy.library.book.model.repository;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import com.proxy.library.book.model.dto.Book;

import java.util.Map;

@Mapper
public interface ProxyRepository {

	@Select("select * from devint.book__c limit 1")
	Book findBook();

	int books(Map<String, Object> mapBooks);

}
