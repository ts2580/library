package com.example.bookshelf.web;

import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;
import org.springframework.ui.Model;

@Component
public class AuthSessionHelper {

    private final MemberRepository memberRepository;

    public AuthSessionHelper(MemberRepository memberRepository) {
        this.memberRepository = memberRepository;
    }

    public Integer getMemberId(HttpSession session) {
        Object memberId = session.getAttribute(SessionKeys.LOGIN_MEMBER_ID);
        return (memberId instanceof Integer) ? (Integer) memberId : null;
    }

    public Member getCurrentMember(HttpSession session) {
        Integer memberId = getMemberId(session);
        if (memberId == null) {
            return null;
        }
        return memberRepository.findById(memberId);
    }

    public boolean isLoggedIn(HttpSession session) {
        return getMemberId(session) != null;
    }

    public void populateMember(Model model, HttpSession session) {
        Member member = getCurrentMember(session);
        model.addAttribute("signedIn", member != null);
        model.addAttribute("member", member);
    }
}
