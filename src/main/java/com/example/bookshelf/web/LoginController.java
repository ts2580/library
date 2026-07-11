package com.example.bookshelf.web;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.web.dto.ProfilePasswordForm;
import com.example.bookshelf.web.dto.ProfileForm;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

@Controller
@RequestMapping("/user")
public class LoginController {

    private final AuthSessionHelper authSessionHelper;
    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${app.registration.enabled:false}")
    private boolean registrationEnabled;

    public LoginController(AuthSessionHelper authSessionHelper,
                           MemberRepository memberRepository,
                           PasswordEncoder passwordEncoder) {
        this.authSessionHelper = authSessionHelper;
        this.memberRepository = memberRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping("/login")
    public String loginPage(@RequestParam(value = "error", required = false) String error,
                            @RequestParam(value = "logout", required = false) String logout,
                            @RequestParam(value = "signupDisabled", required = false) String signupDisabled,
                            Model model) {
        model.addAttribute("registrationEnabled", registrationEnabled);
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

    @GetMapping("/profile")
    public String profile(Model model, HttpSession session) {
        applyProfileFormFromCurrentMember(model, session);
        return "user_profile";
    }

    @PostMapping("/profile")
    public String updateProfile(ProfileForm profileForm,
                               HttpSession session,
                               RedirectAttributes redirectAttributes) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return "redirect:/user/login";
        }

        String name = Texts.trimToNull(profileForm.getName());
        String email = Texts.trimToNull(profileForm.getEmail());
        String description = Texts.trimToNull(profileForm.getDescription());

        if (name != null && name.length() > 120) {
            redirectAttributes.addFlashAttribute("error", "이름은 120자 이하로 입력해 주세요.");
            return "redirect:/user/profile";
        }

        if (email != null && email.length() > 320) {
            redirectAttributes.addFlashAttribute("error", "이메일은 320자 이하로 입력해 주세요.");
            return "redirect:/user/profile";
        }

        if (description != null && description.length() > 2000) {
            redirectAttributes.addFlashAttribute("error", "소개는 2,000자 이하로 입력해 주세요.");
            return "redirect:/user/profile";
        }

        memberRepository.updateProfile(member.id(), email, name, description);
        redirectAttributes.addFlashAttribute("success", "프로필을 저장했습니다.");
        return "redirect:/user/profile";
    }

    @PostMapping("/profile/password")
    public String updatePassword(ProfilePasswordForm profilePasswordForm,
                                HttpSession session,
                                RedirectAttributes redirectAttributes) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return "redirect:/user/login";
        }

        String currentPassword = Texts.trimToNull(profilePasswordForm.getCurrentPassword());
        String newPassword = Texts.trimToNull(profilePasswordForm.getNewPassword());
        String confirmPassword = Texts.trimToNull(profilePasswordForm.getConfirmPassword());

        if (currentPassword == null || newPassword == null || confirmPassword == null) {
            redirectAttributes.addFlashAttribute("error", "현재 비밀번호와 새 비밀번호, 확인값을 모두 입력해 주세요.");
            return "redirect:/user/profile";
        }

        if (!passwordEncoder.matches(currentPassword, member.passwordHash())) {
            redirectAttributes.addFlashAttribute("error", "현재 비밀번호가 일치하지 않습니다.");
            return "redirect:/user/profile";
        }

        if (!newPassword.equals(confirmPassword)) {
            redirectAttributes.addFlashAttribute("error", "새 비밀번호가 확인값과 일치하지 않습니다.");
            return "redirect:/user/profile";
        }

        if (newPassword.length() < 8) {
            redirectAttributes.addFlashAttribute("error", "새 비밀번호는 8자 이상 입력해 주세요.");
            return "redirect:/user/profile";
        }

        if (newPassword.length() > 200) {
            redirectAttributes.addFlashAttribute("error", "새 비밀번호는 200자 이하여야 합니다.");
            return "redirect:/user/profile";
        }

        if (newPassword.equals(currentPassword)) {
            redirectAttributes.addFlashAttribute("error", "현재 비밀번호와 새 비밀번호가 동일합니다.");
            return "redirect:/user/profile";
        }

        memberRepository.updatePasswordHash(member.id(), passwordEncoder.encode(newPassword));
        redirectAttributes.addFlashAttribute("success", "비밀번호를 변경했습니다.");
        return "redirect:/user/profile";
    }

    private void applyProfileFormFromCurrentMember(Model model, HttpSession session) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            model.addAttribute("profileForm", new ProfileForm());
            return;
        }

        ProfileForm profileForm = new ProfileForm();
        profileForm.setName(member.name());
        profileForm.setEmail(member.email());
        profileForm.setDescription(member.description());
        model.addAttribute("profileForm", profileForm);
    }

}
