package com.example.bookshelf.user.service;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.web.dto.SignupForm;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class MemberRegistrationService {

    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;

    public MemberRegistrationService(MemberRepository memberRepository,
                                     PasswordEncoder passwordEncoder) {
        this.memberRepository = memberRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public RegistrationResult register(SignupForm form) {
        String username = Texts.trimToNull(form.getUsername());
        String password = form.getPassword();
        String confirmPassword = form.getConfirmPassword();

        if (username == null) {
            return RegistrationResult.error("아이디는 필수입니다.");
        }
        if (password == null || password.isBlank()) {
            return RegistrationResult.error("비밀번호는 필수입니다.");
        }
        if (!password.equals(confirmPassword)) {
            return RegistrationResult.error("비밀번호 확인이 일치하지 않습니다.");
        }
        if (memberRepository.existsByUsername(username)) {
            return RegistrationResult.error("이미 사용 중인 아이디입니다.");
        }

        Member member = new Member(
                null,
                username,
                passwordEncoder.encode(password),
                Texts.trimToNull(form.getEmail()),
                Texts.trimToNull(form.getName()),
                Texts.trimToNull(form.getDescription())
        );

        try {
            memberRepository.createMember(member);
        } catch (DuplicateKeyException e) {
            return RegistrationResult.error("이미 사용 중인 아이디입니다.");
        }

        Member createdMember = memberRepository.findByUsername(username);
        if (createdMember == null) {
            return RegistrationResult.error("회원가입은 완료됐지만 사용자 조회에 실패했습니다. 다시 로그인해 주세요.");
        }

        return RegistrationResult.success("회원가입이 완료되었습니다. 바로 로그인했습니다.", createdMember);
    }

    public record RegistrationResult(boolean success, String message, Member member) {
        public static RegistrationResult success(String message, Member member) { return new RegistrationResult(true, message, member); }
        public static RegistrationResult error(String message) { return new RegistrationResult(false, message, null); }
    }
}
