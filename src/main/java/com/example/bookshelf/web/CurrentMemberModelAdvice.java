package com.example.bookshelf.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;

@ControllerAdvice(annotations = Controller.class)
public class CurrentMemberModelAdvice {

    private final AuthSessionHelper authSessionHelper;

    public CurrentMemberModelAdvice(AuthSessionHelper authSessionHelper) {
        this.authSessionHelper = authSessionHelper;
    }

    @ModelAttribute
    public void addCurrentMember(Model model, HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        authSessionHelper.populateMember(model, session);
    }
}
