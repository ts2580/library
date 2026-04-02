package com.example.bookshelf.web;

import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
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
        if (memberId instanceof Integer) {
            return (Integer) memberId;
        }

        return resolveMemberIdFromSecurityContext();
    }

    private Integer resolveMemberIdFromSecurityContext() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated() || authentication instanceof AnonymousAuthenticationToken) {
            return null;
        }

        Object principal = authentication.getPrincipal();
        String username = null;
        if (principal instanceof UserDetails userDetails) {
            username = userDetails.getUsername();
        } else if (principal instanceof String) {
            String principalText = (String) principal;
            if ("anonymousUser".equals(principalText)) {
                return null;
            }
            username = principalText;
        }

        if (username == null || username.isBlank()) {
            return null;
        }

        Member member = memberRepository.findByUsername(username);
        return member == null ? null : member.id();
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
