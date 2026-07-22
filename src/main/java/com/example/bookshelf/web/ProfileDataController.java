package com.example.bookshelf.web;

import com.example.bookshelf.user.backup.BookshelfBackupService;
import com.example.bookshelf.user.backup.BookshelfBackupService.BackupException;
import com.example.bookshelf.user.backup.CoverArchiveService;
import com.example.bookshelf.user.backup.CoverArchiveService.CoverArchiveException;
import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.service.CoverRegenerationService;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

@Controller
@RequestMapping("/user/profile")
public class ProfileDataController {

    private static final Logger log = LoggerFactory.getLogger(ProfileDataController.class);
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
            log.warn("Cover archive upload rejected for ownerId={}: {}", member.id(), e.getMessage());
            redirectAttributes.addFlashAttribute("error", e.getMessage());
        } catch (IOException e) {
            log.warn("Failed to read cover archive upload for ownerId={}", member.id(), e);
            redirectAttributes.addFlashAttribute("error", "업로드한 표지 ZIP 파일을 읽지 못했습니다.");
        }
        return "redirect:/user/profile";
    }

    @PostMapping("/covers/archive/upload/chunk")
    @ResponseBody
    public ResponseEntity<ChunkUploadResponse> uploadCoverArchiveChunk(
            @RequestParam("chunk") MultipartFile chunk,
            @RequestParam("uploadId") String uploadId,
            @RequestParam("originalFilename") String originalFilename,
            @RequestParam("totalSize") long totalSize,
            @RequestParam("totalChunks") int totalChunks,
            @RequestParam("chunkIndex") int chunkIndex,
            HttpSession session) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return ResponseEntity.status(401).body(ChunkUploadResponse.error("로그인이 필요합니다."));
        }

        try (var inputStream = chunk.getInputStream()) {
            var result = coverArchiveService.importArchiveChunk(
                    member.id(), uploadId, originalFilename, totalSize, totalChunks,
                    chunkIndex, chunk.getSize(), inputStream
            );
            return ResponseEntity.ok(ChunkUploadResponse.success(result));
        } catch (CoverArchiveException e) {
            log.warn(
                    "Cover archive chunk rejected for ownerId={}, uploadId={}, chunk={}/{}: {}",
                    member.id(), uploadId, chunkIndex + 1, totalChunks, e.getMessage()
            );
            return ResponseEntity.badRequest().body(ChunkUploadResponse.error(e.getMessage()));
        } catch (IOException e) {
            log.warn(
                    "Failed to read cover archive chunk for ownerId={}, uploadId={}, chunk={}/{}",
                    member.id(), uploadId, chunkIndex + 1, totalChunks, e
            );
            return ResponseEntity.internalServerError()
                    .body(ChunkUploadResponse.error("표지 ZIP 청크를 읽지 못했습니다."));
        }
    }

    @GetMapping("/covers/archive/upload/chunk/status")
    @ResponseBody
    public ResponseEntity<ChunkUploadResponse> coverArchiveChunkStatus(
            @RequestParam("uploadId") String uploadId,
            HttpSession session) {
        Member member = authSessionHelper.getCurrentMember(session);
        if (member == null) {
            return ResponseEntity.status(401).body(ChunkUploadResponse.error("로그인이 필요합니다."));
        }
        try {
            var result = coverArchiveService.getArchiveChunkStatus(member.id(), uploadId);
            ChunkUploadResponse response = ChunkUploadResponse.success(result);
            return response.success() ? ResponseEntity.ok(response) : ResponseEntity.badRequest().body(response);
        } catch (CoverArchiveException e) {
            return ResponseEntity.badRequest().body(ChunkUploadResponse.error(e.getMessage()));
        }
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

    public record ChunkUploadResponse(
            boolean success,
            boolean completed,
            boolean processing,
            int uploadedChunks,
            int totalChunks,
            int percent,
            String message
    ) {
        static ChunkUploadResponse success(CoverArchiveService.ChunkUploadResult result) {
            return new ChunkUploadResponse(
                    result.successful(), result.completed(), result.processing(),
                    result.uploadedChunks(), result.totalChunks(),
                    result.percent(), result.message()
            );
        }

        static ChunkUploadResponse error(String message) {
            return new ChunkUploadResponse(false, false, false, 0, 0, 0, message);
        }
    }
}
