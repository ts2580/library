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
    private Boolean isPurchased;
    private String name;
    private String type;
    private Integer volume;
    private Boolean noneedToBuy;
    private Integer id;
    private String isbn;
    private String description;
    private String link;
    private Date pubDate;
    private String author;
}
