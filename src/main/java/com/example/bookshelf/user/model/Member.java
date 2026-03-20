package com.example.bookshelf.user.model;

public record Member(Integer id, String username, String passwordHash, String email, String name, String description) {
}
