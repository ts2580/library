package com.proxy.library.book.model.repository;

import com.proxy.library.book.model.dto.BookByVolume;
import com.proxy.library.book.model.dto.Def;
import com.proxy.library.book.model.dto.ParamVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.proxy.library.book.model.dto.Book;

import java.util.List;
import java.util.Map;

@Mapper
public interface ProxyRepository {

	@Select("select * from devint.book__c limit 1")
	Book findBook();

	@Select("select * from devext.bookbyvolume where name like '%${title}%' order by book, volume desc")
	List<BookByVolume> getBookByVolume(String title);

	int insertBooks(Map<String, Object> mapBooks);

	int insertBookByVolumes(Map<String, Object> mapBooks);

	int updtBookByVolume(Map<String, Object> mapBooks);

	@Select("select * from devext.bookbyvolume where ispurchased = false order by id desc limit 100")
	List<BookByVolume> getBookByVolumeNew();

	int insertStock(Map<String, Object> mapBooks);

	@Select("select * from devext.bookbyvolume where noneedtobuy = false and ispurchased = false")
	List<BookByVolume> getTargetBook();

	@Select(value = "CALL devext.fn_delBook()")
	void delBooks();

	@Select(value = "CALL devext.fn_updtTotPrc()")
	void updtBookPrc();

	int setBookStockByBranch(Map<String, Object> mapBooks);

	void getFieldDef(Map<String, String> mapParam);

	int insertWithNoDto(ParamVo pv);

}
