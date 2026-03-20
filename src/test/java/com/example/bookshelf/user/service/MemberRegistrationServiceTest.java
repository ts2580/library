package com.example.bookshelf.user.service;

import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.web.dto.SignupForm;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MemberRegistrationServiceTest {

    @Mock
    private MemberRepository memberRepository;

    @Mock
    private AuthService authService;

    @InjectMocks
    private MemberRegistrationService memberRegistrationService;

    private SignupForm form;

    @BeforeEach
    void setUp() {
        form = new SignupForm();
        form.setUsername("newuser");
        form.setPassword("password123");
        form.setConfirmPassword("password123");
        form.setEmail("user@example.com");
        form.setName("새사용자");
        form.setDescription("소개");
    }

    @Test
    void register_returnsError_whenUsernameExists() {
        when(memberRepository.existsByUsername("newuser")).thenReturn(true);

        var result = memberRegistrationService.register(form);

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("이미 사용 중인 아이디");
    }

    @Test
    void register_returnsError_whenPasswordMismatch() {
        form.setConfirmPassword("different123");

        var result = memberRegistrationService.register(form);

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("비밀번호 확인");
    }

    @Test
    void register_savesBcryptEncodedPassword() {
        when(memberRepository.existsByUsername("newuser")).thenReturn(false);
        when(authService.encode("password123")).thenReturn("bcrypt-hash");
        when(memberRepository.findByUsername("newuser"))
                .thenReturn(new com.example.bookshelf.user.model.Member(1, "newuser", "bcrypt-hash", "user@example.com", "새사용자", "소개"));

        var result = memberRegistrationService.register(form);

        assertThat(result.success()).isTrue();
        assertThat(result.member()).isNotNull();
        ArgumentCaptor<com.example.bookshelf.user.model.Member> captor = ArgumentCaptor.forClass(com.example.bookshelf.user.model.Member.class);
        verify(memberRepository).createMember(captor.capture());
        assertThat(captor.getValue().passwordHash()).isEqualTo("bcrypt-hash");
    }
}
