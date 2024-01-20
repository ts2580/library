package com.proxy.library.book.model.dto;

import lombok.Data;
import java.util.Date;

@Data
public class Book {
    private String sOriginalkeyC;
    private String totalVolumeC;
    private String typeC;
    private String name;
    private String orderC;
    private Date createdDate;
    private String sfid;
    private Integer id;
    private String coverC;
    private String syncC;
    private Date lastModifiedDate;
    private String descriptionC;
    private String authorC;
}
