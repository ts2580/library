package com.example.bookshelf.web;

import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.user.service.BookOwnershipMigrationService;
import com.example.bookshelf.web.dto.ProfilePasswordForm;
import com.example.bookshelf.web.dto.ProfileForm;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ui.ConcurrentModel;
import org.springframework.ui.Model;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.servlet.mvc.support.RedirectAttributesModelMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LoginControllerTest {

    @Mock
    private AuthSessionHelper authSessionHelper;

    @Mock
    private MemberRepository memberRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private BookOwnershipMigrationService bookOwnershipMigrationService;

    @Test
    void profileReturnsUserProfileView() {
        LoginController controller = new LoginController(authSessionHelper, memberRepository, passwordEncoder, bookOwnershipMigrationService);
        when(authSessionHelper.getCurrentMember(null)).thenReturn(
                new Member(1, "tester", "pw", "tester@example.com", "테스터", null)
        );
        Model model = new ConcurrentModel();
        String view = controller.profile(model, null);

        assertThat(view).isEqualTo("user_profile");
    }

    @Test
    void updateProfileRedirectsToLoginWithoutSessionMember() {
        LoginController controller = new LoginController(authSessionHelper, memberRepository, passwordEncoder, bookOwnershipMigrationService);
        ProfileForm profileForm = new ProfileForm();
        profileForm.setName("new");
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.updateProfile(profileForm, null, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/login");
    }

    @Test
    void updateProfileUpdatesMemberProfile() {
        LoginController controller = new LoginController(authSessionHelper, memberRepository, passwordEncoder, bookOwnershipMigrationService);
        HttpSession session = org.mockito.Mockito.mock(HttpSession.class);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(
                new Member(11, "tester", "pw", "old@example.com", "Old", "old")
        );
        ProfileForm profileForm = new ProfileForm();
        profileForm.setName("New Name");
        profileForm.setEmail("new@example.com");
        profileForm.setDescription("new desc");
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.updateProfile(profileForm, session, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/profile");
        verify(memberRepository).updateProfile(11, "new@example.com", "New Name", "new desc");
    }

    @Test
    void updatePasswordRedirectsToLoginWithoutSessionMember() {
        LoginController controller = new LoginController(authSessionHelper, memberRepository, passwordEncoder, bookOwnershipMigrationService);
        ProfilePasswordForm form = new ProfilePasswordForm();
        form.setCurrentPassword("old");
        form.setNewPassword("newpassword1");
        form.setConfirmPassword("newpassword1");
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.updatePassword(form, null, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/login");
    }

    @Test
    void updatePasswordRejectsWhenCurrentPasswordIsWrong() {
        LoginController controller = new LoginController(authSessionHelper, memberRepository, passwordEncoder, bookOwnershipMigrationService);
        HttpSession session = org.mockito.Mockito.mock(HttpSession.class);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(
                new Member(11, "tester", "old-hashed", "old@example.com", "Old", "old")
        );
        when(passwordEncoder.matches("wrong", "old-hashed")).thenReturn(false);

        ProfilePasswordForm form = new ProfilePasswordForm();
        form.setCurrentPassword("wrong");
        form.setNewPassword("newpassword1");
        form.setConfirmPassword("newpassword1");
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.updatePassword(form, session, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/profile");
        verify(memberRepository, org.mockito.Mockito.never()).updatePasswordHash(org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void updatePasswordRejectsWhenConfirmMismatches() {
        LoginController controller = new LoginController(authSessionHelper, memberRepository, passwordEncoder, bookOwnershipMigrationService);
        HttpSession session = org.mockito.Mockito.mock(HttpSession.class);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(
                new Member(11, "tester", "old-hashed", "old@example.com", "Old", "old")
        );

        ProfilePasswordForm form = new ProfilePasswordForm();
        form.setCurrentPassword("old");
        form.setNewPassword("newpassword1");
        form.setConfirmPassword("other");

        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.updatePassword(form, session, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/profile");
    }

    @Test
    void updatePasswordUpdatesHash() {
        LoginController controller = new LoginController(authSessionHelper, memberRepository, passwordEncoder, bookOwnershipMigrationService);
        HttpSession session = org.mockito.Mockito.mock(HttpSession.class);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(
                new Member(11, "tester", "old-hashed", "old@example.com", "Old", "old")
        );
        when(passwordEncoder.matches("old", "old-hashed")).thenReturn(true);
        when(passwordEncoder.encode("newpassword1")).thenReturn("new-hashed");

        ProfilePasswordForm form = new ProfilePasswordForm();
        form.setCurrentPassword("old");
        form.setNewPassword("newpassword1");
        form.setConfirmPassword("newpassword1");
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.updatePassword(form, session, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/profile");
        verify(passwordEncoder).encode("newpassword1");
        verify(memberRepository).updatePasswordHash(11, "new-hashed");
    }
}
