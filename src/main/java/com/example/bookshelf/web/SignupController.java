package com.example.bookshelf.web;

import com.example.bookshelf.user.service.MemberRegistrationService;
import com.example.bookshelf.web.dto.SignupForm;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.List;

@Controller
@RequestMapping("/user/signup")
public class SignupController {

    private final MemberRegistrationService memberRegistrationService;

    @Value("${app.db.enabled:true}")
    private boolean dbEnabled;

    @Value("${app.registration.enabled:true}")
    private boolean registrationEnabled;

    public SignupController(MemberRegistrationService memberRegistrationService) {
        this.memberRegistrationService = memberRegistrationService;
    }

    @GetMapping
    public String signupPage(Model model) {
        if (!dbEnabled || !registrationEnabled) {
            return "redirect:/user/login?signupDisabled=true";
        }

        model.addAttribute("dbEnabled", dbEnabled);
        model.addAttribute("registrationEnabled", registrationEnabled);
        model.addAttribute("signupForm", new SignupForm());
        return "signup_form";
    }

    @PostMapping
    public String signup(@Valid SignupForm signupForm,
                         BindingResult bindingResult,
                         Model model,
                         HttpServletRequest request) {
        if (!dbEnabled || !registrationEnabled) {
            return "redirect:/user/login?signupDisabled=true";
        }

        model.addAttribute("dbEnabled", dbEnabled);
        model.addAttribute("registrationEnabled", registrationEnabled);
        model.addAttribute("signupForm", signupForm);

        if (bindingResult.hasErrors()) {
            return "signup_form";
        }

        var result = memberRegistrationService.register(signupForm);
        if (!result.success()) {
            model.addAttribute("signupError", result.message());
            return "signup_form";
        }

        Authentication authentication = new UsernamePasswordAuthenticationToken(
                result.member().username(),
                null,
                List.of()
        );
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);

        HttpSession session = request.getSession(true);
        session.setAttribute(SessionKeys.LOGIN_MEMBER_ID, result.member().id());
        session.setAttribute("SPRING_SECURITY_CONTEXT", context);

        return "redirect:/dashboard";
    }
}
