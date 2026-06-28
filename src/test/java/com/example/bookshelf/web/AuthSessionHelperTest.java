package com.example.bookshelf.web;

import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthSessionHelperTest {

    @Mock
    private MemberRepository memberRepository;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void getMemberId_prefersSessionMemberId() {
        HttpSession session = mock(HttpSession.class);
        when(session.getAttribute(SessionKeys.LOGIN_MEMBER_ID)).thenReturn(7);

        AuthSessionHelper helper = new AuthSessionHelper(memberRepository);

        assertThat(helper.getMemberId(session)).isEqualTo(7);
        verify(memberRepository, never()).findByUsername(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void getMemberId_resolvesAuthenticatedPrincipalWhenSessionKeyIsMissing() {
        var principal = User.withUsername("remembered")
                .password("encoded")
                .authorities(AuthorityUtils.createAuthorityList("ROLE_USER"))
                .build();
        var authentication = UsernamePasswordAuthenticationToken.authenticated(
                principal,
                principal.getPassword(),
                principal.getAuthorities()
        );
        SecurityContextHolder.getContext().setAuthentication(authentication);
        when(memberRepository.findByUsername("remembered"))
                .thenReturn(new Member(11, "remembered", "encoded", "r@example.com", "Remembered", null));

        AuthSessionHelper helper = new AuthSessionHelper(memberRepository);

        assertThat(helper.getMemberId(null)).isEqualTo(11);
    }

    @Test
    void getMemberId_returnsNullWhenAnonymous() {
        AuthSessionHelper helper = new AuthSessionHelper(memberRepository);

        assertThat(helper.getMemberId(null)).isNull();
    }
}
