package com.proxy.library.stock.model.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.time.Instant;

@Data
public class StockBook {
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

    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC")
    private Instant pubdate;

    private String author;
}
