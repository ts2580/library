package com.proxy.library.book.model.dto;

import lombok.Data;
import java.util.Date;

@Data
public class Branch {
    private String name;
    private Date createdDate;
    private Double totalpriceint;
    private String totalprice;
    private String sfid;
    private Integer id;
}
