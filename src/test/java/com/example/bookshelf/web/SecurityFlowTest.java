package com.example.bookshelf.web;

import com.example.bookshelf.config.SecurityConfig;
import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.user.service.MemberRegistrationService;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.mockito.Mockito.verifyNoInteractions;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.mock.web.MockHttpSession;
import com.fasterxml.jackson.databind.ObjectMapper;

@WebMvcTest(
        controllers = {LoginController.class, SignupController.class},
        properties = {"app.registration.enabled=true"}
)
@AutoConfigureMockMvc
@Import(SecurityConfig.class)
class SecurityFlowTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @MockBean
    private MemberRepository memberRepository;

    @MockBean
    private MemberRegistrationService memberRegistrationService;

    @MockBean
    private AuthSessionHelper authSessionHelper;

    @Test
    void loginPage_isPublic() throws Exception {
        mockMvc.perform(get("/user/login"))
                .andExpect(status().isOk());
    }

    @Test
    void signupPage_isPublic() throws Exception {
        mockMvc.perform(get("/user/signup"))
                .andExpect(status().isOk());
    }

    @Test
    void protectedPage_redirectsToLogin_whenAnonymous() throws Exception {
        mockMvc.perform(get("/dashboard"))
                .andExpect(status().is3xxRedirection());
    }

    @Test
    void branchInventoryAdministration_isForbiddenForRegularUsers() throws Exception {
        mockMvc.perform(post("/dashboard/branches/refresh-stocks")
                        .with(user("regular").roles("USER"))
                        .with(csrf()))
                .andExpect(status().isForbidden());
    }

    @Test
    void branchInventoryAdministration_passesSecurityForAdmin() throws Exception {
        mockMvc.perform(post("/dashboard/branches/refresh-stocks")
                        .with(user("trstyq").roles("USER", "ADMIN"))
                        .with(csrf()))
                .andExpect(status().isNotFound());
    }

    @Test
    void loginSucceeds_withBcryptPassword() throws Exception {
        String encoded = passwordEncoder.encode("password123");
        when(memberRepository.findByUsername("tester"))
                .thenReturn(new Member(1, "tester", encoded, "t@example.com", "테스터", null));

        mockMvc.perform(post("/user/login")
                        .with(csrf())
                        .param("username", "tester")
                        .param("password", "password123"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/dashboard"));
    }

    @Test
    void loginSucceeds_withLegacySha256Password() throws Exception {
        when(memberRepository.findByUsername("legacy"))
                .thenReturn(new Member(
                        2, "legacy", sha256Hex("legacy-password"), "legacy@example.com", "기존사용자", null
                ));

        mockMvc.perform(post("/user/login")
                        .with(csrf())
                        .param("username", "legacy")
                        .param("password", "legacy-password"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/dashboard"));
    }

    @Test
    void loginWithRememberMe_issuesThirtyDayCookie_andAuthenticatesWithoutSessionCookie() throws Exception {
        String encoded = passwordEncoder.encode("password123");
        when(memberRepository.findByUsername("remembered"))
                .thenReturn(new Member(3, "remembered", encoded, "r@example.com", "기억사용자", null));

        MvcResult loginResult = mockMvc.perform(post("/user/login")
                        .with(csrf())
                        .param("username", "remembered")
                        .param("password", "password123")
                        .param("remember-me", "on"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/dashboard"))
                .andReturn();

        Cookie rememberMe = loginResult.getResponse().getCookie("remember-me");
        assertThat(rememberMe).isNotNull();
        assertThat(rememberMe.getMaxAge()).isEqualTo(30 * 24 * 60 * 60);

        // /dashboard is not part of this WebMvcTest slice. 404 means remember-me passed Security;
        // an unauthenticated request would be redirected to /user/login.
        mockMvc.perform(get("/dashboard").cookie(rememberMe))
                .andExpect(status().isNotFound());
    }

    @Test
    void signupSucceeds_andAutoLogsIn() throws Exception {
        Member created = new Member(1, "newuser", "bcrypt", "u@example.com", "새사용자", null);
        when(memberRegistrationService.register(org.mockito.ArgumentMatchers.any()))
                .thenReturn(MemberRegistrationService.RegistrationResult.success(
                        "회원가입이 완료되었습니다. 바로 로그인했습니다.",
                        created
                ));

        mockMvc.perform(post("/user/signup")
                        .with(csrf())
                        .param("username", "newuser")
                        .param("password", "password123")
                        .param("confirmPassword", "password123")
                        .param("email", "u@example.com"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/dashboard"));
    }

    @Test
    void asyncLoginMissingCsrf_isRejectedBeforeCredentialsAreChecked() throws Exception {
        mockMvc.perform(post("/user/login").header("X-Requested-With", "XMLHttpRequest")
                        .param("username", "tester").param("password", "password123"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("csrf"))
                .andExpect(header().doesNotExist("Location"));
        verifyNoInteractions(memberRepository);
    }

    @Test
    void asyncLoginInvalidCsrf_isRejectedBeforeCredentialsAreChecked() throws Exception {
        mockMvc.perform(post("/user/login").header("X-Requested-With", "XMLHttpRequest")
                        .with(csrf().useInvalidToken())
                        .param("username", "tester").param("password", "password123"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("csrf"));
        verifyNoInteractions(memberRepository);
    }

    @Test
    void asyncLoginExpiredSession_canRefreshTokenAndAuthenticateWithSameCredentials() throws Exception {
        var page = mockMvc.perform(get("/user/login")).andExpect(status().isOk()).andReturn();
        var oldToken = (CsrfToken) page.getRequest().getAttribute("_csrf");
        String value = oldToken.getToken();
        ((MockHttpSession) page.getRequest().getSession(false)).invalidate();
        mockMvc.perform(post("/user/login").header("X-Requested-With", "XMLHttpRequest")
                        .param(oldToken.getParameterName(), value)
                        .param("username", "tester").param("password", "password123"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("csrf"));
        org.mockito.Mockito.verify(memberRepository, org.mockito.Mockito.never()).findByUsername("tester");

        var refresh = mockMvc.perform(get("/user/login/csrf"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.token").isNotEmpty()).andReturn();
        var token = new ObjectMapper().readTree(refresh.getResponse().getContentAsString());
        when(memberRepository.findByUsername("tester"))
                .thenReturn(new Member(1, "tester", passwordEncoder.encode("password123"), "t@example.com", "테스터", null));
        var login = mockMvc.perform(post("/user/login").header("X-Requested-With", "XMLHttpRequest")
                        .session((MockHttpSession) refresh.getRequest().getSession(false))
                        .param(token.get("parameterName").asText(), token.get("token").asText())
                        .param("username", "tester").param("password", "password123")
                        .param("remember-me", "on"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(header().doesNotExist("Location")).andReturn();
        assertThat(login.getRequest().getSession(false).getAttribute(SessionKeys.LOGIN_MEMBER_ID)).isEqualTo(1);
        assertThat(login.getResponse().getCookie("remember-me")).isNotNull();
        mockMvc.perform(get("/dashboard").session((MockHttpSession) login.getRequest().getSession(false)))
                .andExpect(status().isNotFound()); // Passed security; dashboard is outside this MVC slice.
    }

    @Test
    void asyncLoginBadCredentials_returnsDistinctErrorWithoutRedirect() throws Exception {
        mockMvc.perform(post("/user/login").header("X-Requested-With", "XMLHttpRequest")
                        .with(csrf()).param("username", "unknown").param("password", "wrong"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("credentials"))
                .andExpect(header().doesNotExist("Location"));
    }

    @Test
    void ordinaryLoginBadCredentials_keepsFormFallback() throws Exception {
        mockMvc.perform(post("/user/login").with(csrf())
                        .param("username", "unknown").param("password", "wrong"))
                .andExpect(status().isFound()).andExpect(redirectedUrl("/user/login?error"));
    }

    @Test
    void asyncNonLoginRequest_keepsCsrfProtectionAndExistingResponse() throws Exception {
        mockMvc.perform(post("/user/profile").header("X-Requested-With", "XMLHttpRequest")
                        .with(user("tester")))
                .andExpect(status().isForbidden())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().string(""));
    }

    @Test
    void logoutGetIsNotAcceptedAsLogoutFlow() throws Exception {
        mockMvc.perform(get("/user/logout"))
                .andExpect(status().is3xxRedirection());
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

}
