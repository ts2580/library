package com.example.bookshelf.user.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class LoginForm {

    @NotBlank(message = "아이디는 필수입니다.")
    @Size(max = 100)
    private String id;

    @NotBlank(message = "비밀번호는 필수입니다.")
    @Size(min = 4, max = 100)
    private String password;

    public LoginForm() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }
}
