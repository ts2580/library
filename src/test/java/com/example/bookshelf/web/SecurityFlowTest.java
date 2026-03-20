package com.example.bookshelf.web;

import com.example.bookshelf.config.SecurityConfig;
import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.user.service.MemberRegistrationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = {LoginController.class, SignupController.class}, properties = {"app.db.enabled=true", "app.registration.enabled=true"})
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
    void signupSucceeds_andAutoLogsIn() throws Exception {
        Member created = new Member(1, "newuser", "bcrypt", "u@example.com", "새사용자", null);
        when(memberRegistrationService.register(org.mockito.ArgumentMatchers.any()))
                .thenReturn(MemberRegistrationService.RegistrationResult.success("회원가입 완료! 바로 로그인했어요.", created));

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
    void logoutGetIsNotAcceptedAsLogoutFlow() throws Exception {
        mockMvc.perform(get("/user/logout"))
                .andExpect(status().is3xxRedirection());
    }
}
