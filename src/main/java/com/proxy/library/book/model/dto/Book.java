package com.proxy.library.book.model.dto;

import lombok.Data;
import java.util.Date;

@Data
public class Book {
    private String sOriginalkey;
    private String totalVolume;
    private String type;
    private String name;
    private String order;
    private Date createdDate;
    private String sfid;
    private Integer id;
    private String cover;
    private String sync;
    private Date lastModifiedDate;
    private String description;
    private String author;
}
