package com.example.bookshelf.user.backup;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@Service
public class CoverArchiveService {

    public static final long MAX_UPLOAD_BYTES = 500L * 1024 * 1024;
    private static final long MAX_EXPANDED_BYTES = 2L * 1024 * 1024 * 1024;
    private static final long MAX_IMAGE_BYTES = 25L * 1024 * 1024;
    private static final int MAX_ENTRIES = 50_000;
    private static final int BUFFER_SIZE = 16 * 1024;
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("jpg", "jpeg", "png", "gif", "webp");

    private final BookshelfBackupRepository repository;
    private final Path coverRoot;

    public CoverArchiveService(BookshelfBackupRepository repository,
                               @Value("${app.covers.storage-dir:./data/covers}") String coverStorageDir) {
        this.repository = repository;
        this.coverRoot = Path.of(coverStorageDir).toAbsolutePath().normalize();
    }

    public void writeArchive(int ownerId, OutputStream outputStream) throws IOException {
        Map<String, Path> files = resolveOwnedCoverFiles(ownerId);
        try (ZipOutputStream zip = new ZipOutputStream(outputStream)) {
            for (Map.Entry<String, Path> file : files.entrySet()) {
                if (!Files.isRegularFile(file.getValue())) {
                    continue;
                }
                ZipEntry entry = new ZipEntry("covers/" + file.getKey());
                entry.setTime(0L);
                zip.putNextEntry(entry);
                Files.copy(file.getValue(), zip);
                zip.closeEntry();
            }
            zip.finish();
        }
    }

    public ImportResult importArchive(int ownerId,
                                      String originalFilename,
                                      long fileSize,
                                      InputStream inputStream) {
        validateUpload(originalFilename, fileSize);
        Set<String> allowedFilenames = new LinkedHashSet<>(resolveOwnedCoverFiles(ownerId).keySet());
        Path stagingRoot = null;
        try {
            Files.createDirectories(coverRoot);
            stagingRoot = Files.createTempDirectory(coverRoot, ".cover-import-");
            StagedArchive staged = stageArchive(inputStream, stagingRoot, allowedFilenames);

            int restored = 0;
            int skippedExisting = 0;
            for (Map.Entry<String, Path> file : staged.files().entrySet()) {
                Path destination = resolveCoverFile(file.getKey());
                if (Files.isRegularFile(destination)) {
                    skippedExisting++;
                    repository.markLocalCoverAvailableForOwner(ownerId, "/covers/" + file.getKey());
                    continue;
                }
                moveIntoStorage(file.getValue(), destination);
                repository.markLocalCoverAvailableForOwner(ownerId, "/covers/" + file.getKey());
                restored++;
            }
            return new ImportResult(restored, skippedExisting, staged.ignored());
        } catch (CoverArchiveException e) {
            throw e;
        } catch (IOException e) {
            throw new CoverArchiveException("표지 ZIP 파일을 복원하지 못했습니다.", e);
        } finally {
            deleteStagingDirectory(stagingRoot);
        }
    }

    private Map<String, Path> resolveOwnedCoverFiles(int ownerId) {
        Map<String, Path> files = new LinkedHashMap<>();
        for (String coverUrl : repository.findLocalCoverUrlsForOwner(ownerId)) {
            String filename = extractSafeFilename(coverUrl);
            if (filename != null) {
                files.putIfAbsent(filename, resolveCoverFile(filename));
            }
        }
        return files;
    }

    private StagedArchive stageArchive(InputStream inputStream,
                                       Path stagingRoot,
                                       Set<String> allowedFilenames) throws IOException {
        Map<String, Path> stagedFiles = new LinkedHashMap<>();
        Set<String> seenNames = new HashSet<>();
        int entryCount = 0;
        int ignored = 0;
        long expandedBytes = 0L;
        byte[] buffer = new byte[BUFFER_SIZE];

        try (ZipInputStream zip = new ZipInputStream(inputStream)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entryCount > MAX_ENTRIES) {
                    throw new CoverArchiveException("표지 ZIP의 파일 수가 허용 범위를 초과합니다.");
                }
                if (entry.isDirectory()) {
                    zip.closeEntry();
                    continue;
                }
                String filename = parseArchiveEntry(entry.getName());
                if (!seenNames.add(filename)) {
                    throw new CoverArchiveException("표지 ZIP에 중복 파일이 있습니다: " + filename);
                }
                if (!allowedFilenames.contains(filename)) {
                    ignored++;
                    expandedBytes += drainEntry(zip, buffer);
                    if (expandedBytes > MAX_EXPANDED_BYTES) {
                        throw new CoverArchiveException("표지 ZIP의 압축 해제 크기가 허용 범위를 초과합니다.");
                    }
                    zip.closeEntry();
                    continue;
                }

                Path stagedFile = stagingRoot.resolve(filename).normalize();
                if (!stagedFile.startsWith(stagingRoot)) {
                    throw new CoverArchiveException("표지 ZIP에 안전하지 않은 경로가 있습니다.");
                }
                long imageBytes = 0L;
                try (OutputStream stagedOutput = Files.newOutputStream(
                        stagedFile, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                    int read;
                    while ((read = zip.read(buffer)) != -1) {
                        imageBytes += read;
                        expandedBytes += read;
                        if (imageBytes > MAX_IMAGE_BYTES || expandedBytes > MAX_EXPANDED_BYTES) {
                            throw new CoverArchiveException("표지 ZIP의 압축 해제 크기가 허용 범위를 초과합니다.");
                        }
                        stagedOutput.write(buffer, 0, read);
                    }
                }
                validateImageSignature(stagedFile, filename);
                stagedFiles.put(filename, stagedFile);
                zip.closeEntry();
            }
        }
        return new StagedArchive(stagedFiles, ignored);
    }

    private static long drainEntry(ZipInputStream zip, byte[] buffer) throws IOException {
        long bytes = 0L;
        int read;
        while ((read = zip.read(buffer)) != -1) {
            bytes += read;
            if (bytes > MAX_IMAGE_BYTES) {
                throw new CoverArchiveException("표지 ZIP의 파일 크기가 허용 범위를 초과합니다.");
            }
        }
        return bytes;
    }

    private static String parseArchiveEntry(String entryName) {
        if (entryName == null || entryName.isBlank() || entryName.indexOf('\0') >= 0) {
            throw new CoverArchiveException("표지 ZIP에 잘못된 파일명이 있습니다.");
        }
        String normalized = entryName.replace('\\', '/');
        if (normalized.startsWith("/") || normalized.contains("../") || normalized.contains("/../")) {
            throw new CoverArchiveException("표지 ZIP에 안전하지 않은 경로가 있습니다.");
        }
        String filename;
        if (normalized.startsWith("covers/")) {
            filename = normalized.substring("covers/".length());
        } else {
            filename = normalized;
        }
        if (filename.isBlank() || filename.contains("/")) {
            throw new CoverArchiveException("표지 ZIP은 covers 폴더 바로 아래의 파일만 지원합니다.");
        }
        validateExtension(filename);
        return filename;
    }

    private static void validateExtension(String filename) {
        int dot = filename.lastIndexOf('.');
        String extension = dot < 0 ? "" : filename.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new CoverArchiveException("지원하지 않는 표지 파일 형식입니다: " + filename);
        }
    }

    private static void validateImageSignature(Path file, String filename) throws IOException {
        byte[] header = new byte[12];
        int length;
        try (InputStream input = Files.newInputStream(file)) {
            length = input.read(header);
        }
        boolean jpeg = length >= 3 && unsigned(header[0]) == 0xFF && unsigned(header[1]) == 0xD8 && unsigned(header[2]) == 0xFF;
        boolean png = length >= 8 && Arrays.equals(Arrays.copyOf(header, 8), new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A});
        boolean gif = length >= 6 && (startsWithAscii(header, "GIF87a") || startsWithAscii(header, "GIF89a"));
        boolean webp = length >= 12 && startsWithAscii(header, "RIFF")
                && header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P';
        if (!jpeg && !png && !gif && !webp) {
            throw new CoverArchiveException("이미지 파일이 아닌 항목이 포함되어 있습니다: " + filename);
        }
    }

    private static int unsigned(byte value) {
        return value & 0xFF;
    }

    private static boolean startsWithAscii(byte[] value, String prefix) {
        for (int i = 0; i < prefix.length(); i++) {
            if (value[i] != (byte) prefix.charAt(i)) {
                return false;
            }
        }
        return true;
    }

    private Path resolveCoverFile(String filename) {
        Path file = coverRoot.resolve(filename).normalize();
        if (!file.startsWith(coverRoot)) {
            throw new CoverArchiveException("안전하지 않은 표지 파일 경로입니다.");
        }
        return file;
    }

    private static String extractSafeFilename(String coverUrl) {
        if (coverUrl == null || !coverUrl.startsWith("/covers/")) {
            return null;
        }
        String filename = coverUrl.substring("/covers/".length());
        if (filename.isBlank() || filename.contains("/") || filename.contains("\\")) {
            return null;
        }
        try {
            validateExtension(filename);
            return filename;
        } catch (CoverArchiveException ignored) {
            return null;
        }
    }

    private static void moveIntoStorage(Path source, Path destination) throws IOException {
        try {
            Files.move(source, destination, StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
            Files.move(source, destination);
        }
    }

    private static void validateUpload(String originalFilename, long fileSize) {
        String filename = originalFilename == null ? "" : originalFilename.toLowerCase(Locale.ROOT);
        if (!filename.endsWith(".zip")) {
            throw new CoverArchiveException("표지 백업은 .zip 파일만 업로드할 수 있습니다.");
        }
        if (fileSize <= 0) {
            throw new CoverArchiveException("업로드할 표지 ZIP 파일을 선택해 주세요.");
        }
        if (fileSize > MAX_UPLOAD_BYTES) {
            throw new CoverArchiveException("표지 ZIP 파일은 500MB 이하만 업로드할 수 있습니다.");
        }
    }

    private static void deleteStagingDirectory(Path stagingRoot) {
        if (stagingRoot == null || !Files.exists(stagingRoot)) {
            return;
        }
        try (var paths = Files.walk(stagingRoot)) {
            paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // Best-effort cleanup of request-scoped staging files.
                }
            });
        } catch (IOException ignored) {
            // Best-effort cleanup of request-scoped staging files.
        }
    }

    private record StagedArchive(Map<String, Path> files, int ignored) {
    }

    public record ImportResult(int restored, int skippedExisting, int ignored) {
        public String summary() {
            return "표지 복원 완료: 새 파일 " + restored + "개, 기존 파일 " + skippedExisting
                    + "개, 현재 계정에서 사용하지 않아 제외 " + ignored + "개";
        }
    }

    public static class CoverArchiveException extends RuntimeException {
        public CoverArchiveException(String message) {
            super(message);
        }

        public CoverArchiveException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
