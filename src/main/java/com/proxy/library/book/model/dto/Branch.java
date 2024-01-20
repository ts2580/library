package com.proxy.library.book.model.dto;

import lombok.Data;
import java.util.Date;

@Data
public class Branch {
    private String name;
    private Date createdDate;
    private Double totalpriceintC;
    private String totalpriceC;
    private String sfid;
    private Integer id;
}
