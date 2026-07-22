package com.example.bookshelf.web;

import com.example.bookshelf.user.backup.BookshelfBackupService;
import com.example.bookshelf.user.backup.BookshelfBackupService.BackupException;
import com.example.bookshelf.user.backup.CoverArchiveService;
import com.example.bookshelf.user.backup.CoverArchiveService.CoverArchiveException;
import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.service.CoverRegenerationService;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

@Controller
@RequestMapping("/user/profile")
public class ProfileDataController {

    private static final MediaType XLSX_MEDIA_TYPE = MediaType.parseMediaType(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    private static final MediaType ZIP_MEDIA_TYPE = MediaType.parseMediaType("application/zip");

    private final AuthSessionHelper authSessionHelper;
    private final BookshelfBackupService backupService;
    private final CoverRegenerationService coverRegenerationService;
    private final CoverArchiveService coverArchiveService;

    public ProfileDataController(AuthSessionHelper authSessionHelper,
                                 BookshelfBackupService backupService,
                                 CoverRegenerationService coverRegenerationService,
                                 CoverArchiveService coverArchiveService) {
        this.authSessionHelper = authSessionHelper;
        this.backupService = backupService;
        this.coverRegenerationService = coverRegenerationService;
        this.coverArchiveService = coverArchiveService;
    }

    @GetMapping("/backup/download")
    public ResponseEntity<byte[]> downloadBackup(HttpSession session) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return ResponseEntity.status(401).build();
        }

        byte[] workbook = backupService.exportBackup(member);
        String safeUsername = member.username().replaceAll("[^A-Za-z0-9_-]", "_");
        String filename = "bookshelf-backup-" + safeUsername + "-" + LocalDate.now() + ".xlsx";
        ContentDisposition disposition = ContentDisposition.attachment()
                .filename(filename, StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .contentType(XLSX_MEDIA_TYPE)
                .contentLength(workbook.length)
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .body(workbook);
    }

    @PostMapping("/backup/upload")
    public String uploadBackup(@RequestParam("backupFile") MultipartFile backupFile,
                               HttpSession session,
                               RedirectAttributes redirectAttributes) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return "redirect:/user/login";
        }

        try (var inputStream = backupFile.getInputStream()) {
            var result = backupService.importBackup(
                    member.id(),
                    backupFile.getOriginalFilename(),
                    backupFile.getSize(),
                    inputStream
            );
            redirectAttributes.addFlashAttribute("success", result.summary());
        } catch (BackupException e) {
            redirectAttributes.addFlashAttribute("error", e.getMessage());
        } catch (IOException e) {
            redirectAttributes.addFlashAttribute("error", "업로드한 엑셀 파일을 읽지 못했습니다.");
        }
        return "redirect:/user/profile";
    }

    @GetMapping("/covers/archive/download")
    public ResponseEntity<StreamingResponseBody> downloadCoverArchive(HttpSession session) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return ResponseEntity.status(401).build();
        }

        String safeUsername = member.username().replaceAll("[^A-Za-z0-9_-]", "_");
        String filename = "bookshelf-covers-" + safeUsername + "-" + LocalDate.now() + ".zip";
        ContentDisposition disposition = ContentDisposition.attachment()
                .filename(filename, StandardCharsets.UTF_8)
                .build();
        StreamingResponseBody body = outputStream -> coverArchiveService.writeArchive(member.id(), outputStream);
        return ResponseEntity.ok()
                .contentType(ZIP_MEDIA_TYPE)
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .body(body);
    }

    @PostMapping("/covers/archive/upload")
    public String uploadCoverArchive(@RequestParam("coverArchive") MultipartFile coverArchive,
                                     HttpSession session,
                                     RedirectAttributes redirectAttributes) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return "redirect:/user/login";
        }

        try (var inputStream = coverArchive.getInputStream()) {
            var result = coverArchiveService.importArchive(
                    member.id(), coverArchive.getOriginalFilename(), coverArchive.getSize(), inputStream
            );
            redirectAttributes.addFlashAttribute("success", result.summary());
        } catch (CoverArchiveException e) {
            redirectAttributes.addFlashAttribute("error", e.getMessage());
        } catch (IOException e) {
            redirectAttributes.addFlashAttribute("error", "업로드한 표지 ZIP 파일을 읽지 못했습니다.");
        }
        return "redirect:/user/profile";
    }

    @PostMapping("/covers/regenerate")
    public String regenerateCovers(HttpSession session, RedirectAttributes redirectAttributes) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return "redirect:/user/login";
        }

        var result = coverRegenerationService.regeneratePendingCovers(member.id());
        redirectAttributes.addFlashAttribute("success", result.summary());
        return "redirect:/user/profile";
    }
}
