package com.example.bookshelf.web;

import com.example.bookshelf.user.model.dto.LoginForm;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
@RequestMapping("/user")
public class LoginController {

    @Value("${app.db.enabled:false}")
    private boolean dbEnabled;

    @Value("${app.registration.enabled:false}")
    private boolean registrationEnabled;

    @GetMapping("/login")
    public String loginPage(@RequestParam(value = "error", required = false) String error,
                            @RequestParam(value = "logout", required = false) String logout,
                            @RequestParam(value = "signupDisabled", required = false) String signupDisabled,
                            Model model) {
        model.addAttribute("dbEnabled", dbEnabled);
        model.addAttribute("registrationEnabled", registrationEnabled);
        model.addAttribute("loginForm", new LoginForm());

        if (error != null) {
            model.addAttribute("loginError", "아이디 또는 비밀번호가 일치하지 않습니다.");
        }
        if (logout != null) {
            model.addAttribute("logoutMessage", "로그아웃되었어요.");
        }
        if (signupDisabled != null) {
            model.addAttribute("signupError", "현재 회원가입이 비활성화되어 있습니다.");
        }
        return "login_form";
    }
}
