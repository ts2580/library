package com.proxy.library.book.model.dto;

import lombok.Data;

@Data
public class Token {
    private String access_token;
    private String instance_url;
    private String id;
    private String token_type;
    private String issued_at;
    private String signature;
}
