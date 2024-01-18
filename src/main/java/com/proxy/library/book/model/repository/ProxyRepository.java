package com.proxy.library.book.model.repository;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import com.proxy.library.book.model.dto.Book;
import org.springframework.stereotype.Repository;

@Mapper
@Repository
public interface ProxyRepository {

    @Select("SELECT * FROM devint.book__c limit 1")
	Book findBook();

}
