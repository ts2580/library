package com.example.bookshelf.integration.aladin;

public class AladinRateLimitException extends RuntimeException {

    public AladinRateLimitException(String message, Throwable cause) {
        super(message, cause);
    }
}
