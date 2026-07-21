package com.example.bookshelf.web;

import com.example.bookshelf.user.backup.BookshelfBackupService;
import com.example.bookshelf.user.backup.CoverArchiveService;
import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.service.CoverRegenerationService;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.servlet.mvc.support.RedirectAttributesModelMap;

import java.io.InputStream;
import java.io.ByteArrayOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProfileDataControllerTest {

    @Mock private AuthSessionHelper authSessionHelper;
    @Mock private BookshelfBackupService backupService;
    @Mock private CoverRegenerationService coverRegenerationService;
    @Mock private CoverArchiveService coverArchiveService;
    @Mock private HttpSession session;

    @Test
    void uploadBackup_alwaysUsesCurrentSessionMemberAsOwner() {
        Member member = new Member(42, "current-user", "pw", null, null, null);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(member);
        when(backupService.importBackup(eq(42), eq("backup.xlsx"), eq(3L), any(InputStream.class)))
                .thenReturn(new BookshelfBackupService.ImportResult(1, 0, 2, 0));
        MockMultipartFile file = new MockMultipartFile(
                "backupFile", "backup.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                new byte[]{1, 2, 3}
        );
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller().uploadBackup(file, session, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/profile");
        verify(backupService).importBackup(eq(42), eq("backup.xlsx"), eq(3L), any(InputStream.class));
        assertThat(redirectAttributes.getFlashAttributes().get("success").toString()).contains("도서 추가 1건");
    }

    @Test
    void regenerateCovers_onlyRunsForCurrentSessionMember() {
        when(authSessionHelper.getCurrentMember(session)).thenReturn(
                new Member(77, "current-user", "pw", null, null, null)
        );
        when(coverRegenerationService.regeneratePendingCovers(77))
                .thenReturn(new CoverRegenerationService.RegenerationResult(1, 1, 2, 1));
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller().regenerateCovers(session, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/profile");
        verify(coverRegenerationService).regeneratePendingCovers(77);
        assertThat(redirectAttributes.getFlashAttributes().get("success").toString()).contains("실패 1건");
    }

    @Test
    void downloadBackup_returnsXlsxForCurrentSessionMember() {
        Member member = new Member(9, "tester", "pw", null, null, null);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(member);
        when(backupService.exportBackup(member)).thenReturn(new byte[]{4, 5, 6});

        var response = controller().downloadBackup(session);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getContentType().toString())
                .isEqualTo("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        assertThat(response.getHeaders().getFirst("Content-Disposition")).contains("bookshelf-backup-tester-");
        assertThat(response.getBody()).containsExactly(4, 5, 6);
    }

    @Test
    void uploadCoverArchive_alwaysUsesCurrentSessionMemberAsOwner() {
        Member member = new Member(52, "cover-owner", "pw", null, null, null);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(member);
        when(coverArchiveService.importArchive(eq(52), eq("covers.zip"), eq(3L), any(InputStream.class)))
                .thenReturn(new CoverArchiveService.ImportResult(2, 1, 0));
        MockMultipartFile file = new MockMultipartFile(
                "coverArchive", "covers.zip", "application/zip", new byte[]{1, 2, 3}
        );
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller().uploadCoverArchive(file, session, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/user/profile");
        verify(coverArchiveService).importArchive(eq(52), eq("covers.zip"), eq(3L), any(InputStream.class));
        assertThat(redirectAttributes.getFlashAttributes().get("success").toString()).contains("새 파일 2개");
    }

    @Test
    void downloadCoverArchive_streamsCurrentOwnersZip() throws Exception {
        Member member = new Member(29, "cover-tester", "pw", null, null, null);
        when(authSessionHelper.getCurrentMember(session)).thenReturn(member);
        var response = controller().downloadCoverArchive(session);
        ByteArrayOutputStream output = new ByteArrayOutputStream();

        response.getBody().writeTo(output);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getContentType().toString()).isEqualTo("application/zip");
        assertThat(response.getHeaders().getFirst("Content-Disposition")).contains("bookshelf-covers-cover-tester-");
        verify(coverArchiveService).writeArchive(29, output);
    }

    private ProfileDataController controller() {
        return new ProfileDataController(authSessionHelper, backupService, coverRegenerationService, coverArchiveService);
    }
}
