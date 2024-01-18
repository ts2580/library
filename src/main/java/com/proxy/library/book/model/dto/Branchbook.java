package com.proxy.library.book.model.dto;

import lombok.Data;

@Data
public class Branchbook {
    private String book;
    private Integer volume;
    private String name;
    private String branch;
    private String branchName;
    private String bookLink;
    private String minPrice;
    private Integer id;
}
