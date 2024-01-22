package com.proxy.library.book.model.dto;

import lombok.Data;
import java.util.Date;

@Data
public class BookByVolume {
    private Integer seq;
    private String book;
    private String cover;
    private String isbn13;
    private String price;
    private Boolean ispurchased;
    private String name;
    private String type;
    private Integer volume;
    private Boolean noneedtobuy;
    private Integer id;
    private String isbn;
    private String description;
    private String link;
    private Date pubdate;
    private String author;
}
