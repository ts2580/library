package com.example.bookshelf;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BookshelfApplication {
    public static void main(String[] args) {
        ensureDataDirectory();
        SpringApplication.run(BookshelfApplication.class, args);
    }

    private static void ensureDataDirectory() {
        try {
            Files.createDirectories(Path.of("data"));
        } catch (IOException e) {
            throw new IllegalStateException("Failed to create data directory for SQLite database.", e);
        }
    }
}
