package com.example.bookshelf.user.backup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@Service
public class CoverArchiveService {

    private static final Logger log = LoggerFactory.getLogger(CoverArchiveService.class);
    public static final long MAX_UPLOAD_BYTES = 500L * 1024 * 1024;
    public static final long MAX_CHUNKED_UPLOAD_BYTES = 2L * 1024 * 1024 * 1024;
    public static final int CHUNK_BYTES = 8 * 1024 * 1024;
    private static final long MAX_EXPANDED_BYTES = 2L * 1024 * 1024 * 1024;
    private static final long MAX_IMAGE_BYTES = 25L * 1024 * 1024;
    private static final int MAX_ENTRIES = 50_000;
    private static final int BUFFER_SIZE = 16 * 1024;
    private static final Duration ABANDONED_UPLOAD_TTL = Duration.ofHours(24);
    private static final String CHUNK_MANIFEST = "upload.properties";
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("jpg", "jpeg", "png", "gif", "webp");

    private final BookshelfBackupRepository repository;
    private final Path coverRoot;
    private final Path chunkUploadRoot;
    private final Executor coverArchiveExecutor;
    private final Map<String, ChunkJobState> chunkJobStates = new ConcurrentHashMap<>();

    @Autowired
    public CoverArchiveService(BookshelfBackupRepository repository,
                               @Value("${app.covers.storage-dir:./data/covers}") String coverStorageDir,
                               @Qualifier("coverArchiveExecutor") Executor coverArchiveExecutor) {
        this.repository = repository;
        this.coverRoot = Path.of(coverStorageDir).toAbsolutePath().normalize();
        this.chunkUploadRoot = coverRoot.getParent().resolve(".cover-uploads").normalize();
        this.coverArchiveExecutor = coverArchiveExecutor;
    }

    public CoverArchiveService(BookshelfBackupRepository repository, String coverStorageDir) {
        this(repository, coverStorageDir, Runnable::run);
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
        return importArchive(ownerId, originalFilename, fileSize, inputStream, MAX_UPLOAD_BYTES);
    }

    private ImportResult importArchive(int ownerId,
                                       String originalFilename,
                                       long fileSize,
                                       InputStream inputStream,
                                       long maxUploadBytes) {
        validateUpload(originalFilename, fileSize, maxUploadBytes);
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

    public synchronized ChunkUploadResult importArchiveChunk(int ownerId,
                                                              String uploadId,
                                                              String originalFilename,
                                                              long totalSize,
                                                              int totalChunks,
                                                              int chunkIndex,
                                                              long chunkSize,
                                                              InputStream inputStream) {
        ChunkUploadMetadata requested = validateChunkRequest(
                ownerId, uploadId, originalFilename, totalSize, totalChunks, chunkIndex, chunkSize
        );
        String jobKey = chunkJobKey(ownerId, uploadId);
        ChunkJobState existingJob = chunkJobStates.get(jobKey);
        if (existingJob != null) {
            return existingJob.result();
        }
        Path uploadDirectory = resolveChunkUploadDirectory(ownerId, uploadId);
        try {
            Files.createDirectories(chunkUploadRoot);
            cleanupAbandonedChunkUploads();
            Files.createDirectories(uploadDirectory);
            validateOrCreateManifest(uploadDirectory, requested);
            writeChunk(uploadDirectory, chunkIndex, chunkSize, inputStream);

            int uploadedChunks = countUploadedChunks(uploadDirectory, totalChunks);
            if (uploadedChunks < totalChunks) {
                return ChunkUploadResult.uploading(uploadedChunks, totalChunks);
            }

            ChunkUploadResult processing = ChunkUploadResult.processing(totalChunks);
            chunkJobStates.put(jobKey, new ChunkJobState(processing, Instant.now()));
            try {
                coverArchiveExecutor.execute(() -> processAssembledArchive(
                        jobKey, uploadDirectory, ownerId, originalFilename, totalSize, totalChunks
                ));
            } catch (RuntimeException e) {
                deleteStagingDirectory(uploadDirectory);
                ChunkUploadResult failed = ChunkUploadResult.failed(
                        totalChunks, "표지 ZIP 복원 작업을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."
                );
                chunkJobStates.put(jobKey, new ChunkJobState(failed, Instant.now()));
                log.warn("Failed to schedule cover archive import ownerId={}, uploadId={}", ownerId, uploadId, e);
            }
            return chunkJobStates.get(jobKey).result();
        } catch (CoverArchiveException e) {
            if (allChunksPresent(uploadDirectory, totalChunks)) {
                deleteStagingDirectory(uploadDirectory);
            }
            throw e;
        } catch (IOException e) {
            if (allChunksPresent(uploadDirectory, totalChunks)) {
                deleteStagingDirectory(uploadDirectory);
            }
            throw new CoverArchiveException("표지 ZIP 청크를 처리하지 못했습니다.", e);
        }
    }

    public ChunkUploadResult getArchiveChunkStatus(int ownerId, String uploadId) {
        String normalizedUploadId = normalizeUploadId(uploadId);
        ChunkJobState state = chunkJobStates.get(chunkJobKey(ownerId, normalizedUploadId));
        if (state == null) {
            throw new CoverArchiveException("표지 ZIP 복원 작업 상태를 찾을 수 없습니다.");
        }
        return state.result();
    }

    private void processAssembledArchive(String jobKey,
                                         Path uploadDirectory,
                                         int ownerId,
                                         String originalFilename,
                                         long totalSize,
                                         int totalChunks) {
        try {
            Path assembledArchive = uploadDirectory.resolve("assembled.zip");
            assembleChunks(uploadDirectory, assembledArchive, totalChunks, totalSize);
            try (InputStream archiveInput = Files.newInputStream(assembledArchive)) {
                ImportResult result = importArchive(
                        ownerId, originalFilename, totalSize, archiveInput, MAX_CHUNKED_UPLOAD_BYTES
                );
                chunkJobStates.put(
                        jobKey,
                        new ChunkJobState(ChunkUploadResult.completed(totalChunks, result), Instant.now())
                );
            }
        } catch (Exception e) {
            String message = e instanceof CoverArchiveException && e.getMessage() != null
                    ? e.getMessage()
                    : "표지 ZIP 파일을 복원하지 못했습니다.";
            chunkJobStates.put(
                    jobKey,
                    new ChunkJobState(ChunkUploadResult.failed(totalChunks, message), Instant.now())
            );
            log.warn("Cover archive import failed ownerId={}, jobKey={}: {}", ownerId, jobKey, message, e);
        } finally {
            deleteStagingDirectory(uploadDirectory);
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

    private ChunkUploadMetadata validateChunkRequest(int ownerId,
                                                     String uploadId,
                                                     String originalFilename,
                                                     long totalSize,
                                                     int totalChunks,
                                                     int chunkIndex,
                                                     long chunkSize) {
        if (ownerId <= 0) {
            throw new CoverArchiveException("유효한 사용자만 표지 ZIP을 업로드할 수 있습니다.");
        }
        normalizeUploadId(uploadId);
        validateChunkedFilename(originalFilename);
        if (totalSize <= 0 || totalSize > MAX_CHUNKED_UPLOAD_BYTES) {
            throw new CoverArchiveException("청크 업로드 표지 ZIP 파일은 2GB 이하만 지원합니다.");
        }
        int expectedTotalChunks = (int) ((totalSize + CHUNK_BYTES - 1L) / CHUNK_BYTES);
        if (totalChunks != expectedTotalChunks || chunkIndex < 0 || chunkIndex >= totalChunks) {
            throw new CoverArchiveException("표지 ZIP 청크 순서가 올바르지 않습니다.");
        }
        long expectedChunkSize = chunkIndex == totalChunks - 1
                ? totalSize - (long) chunkIndex * CHUNK_BYTES
                : CHUNK_BYTES;
        if (chunkSize != expectedChunkSize) {
            throw new CoverArchiveException("표지 ZIP 청크 크기가 올바르지 않습니다.");
        }
        return new ChunkUploadMetadata(originalFilename, totalSize, totalChunks);
    }

    private static String normalizeUploadId(String uploadId) {
        String normalizedUploadId;
        try {
            normalizedUploadId = UUID.fromString(uploadId).toString();
        } catch (RuntimeException e) {
            throw new CoverArchiveException("표지 ZIP 업로드 ID가 올바르지 않습니다.");
        }
        if (!normalizedUploadId.equals(uploadId)) {
            throw new CoverArchiveException("표지 ZIP 업로드 ID가 올바르지 않습니다.");
        }
        return normalizedUploadId;
    }

    private static String chunkJobKey(int ownerId, String uploadId) {
        return ownerId + ":" + uploadId;
    }

    private static void validateChunkedFilename(String originalFilename) {
        String filename = originalFilename == null ? "" : originalFilename;
        if (filename.length() > 255 || filename.contains("/") || filename.contains("\\")
                || !filename.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            throw new CoverArchiveException("표지 백업은 .zip 파일만 업로드할 수 있습니다.");
        }
    }

    private Path resolveChunkUploadDirectory(int ownerId, String uploadId) {
        Path directory = chunkUploadRoot.resolve(ownerId + "-" + uploadId).normalize();
        if (!directory.startsWith(chunkUploadRoot)) {
            throw new CoverArchiveException("안전하지 않은 청크 업로드 경로입니다.");
        }
        return directory;
    }

    private static void validateOrCreateManifest(Path uploadDirectory,
                                                 ChunkUploadMetadata requested) throws IOException {
        Path manifest = uploadDirectory.resolve(CHUNK_MANIFEST);
        if (Files.exists(manifest)) {
            Properties properties = new Properties();
            try (InputStream input = Files.newInputStream(manifest)) {
                properties.load(input);
            }
            ChunkUploadMetadata stored;
            try {
                stored = new ChunkUploadMetadata(
                        properties.getProperty("originalFilename"),
                        Long.parseLong(properties.getProperty("totalSize", "-1")),
                        Integer.parseInt(properties.getProperty("totalChunks", "-1"))
                );
            } catch (NumberFormatException e) {
                throw new CoverArchiveException("청크 업로드 정보가 손상되었습니다.", e);
            }
            if (!stored.equals(requested)) {
                throw new CoverArchiveException("이전 청크와 업로드 정보가 일치하지 않습니다.");
            }
            return;
        }

        Properties properties = new Properties();
        properties.setProperty("originalFilename", requested.originalFilename());
        properties.setProperty("totalSize", Long.toString(requested.totalSize()));
        properties.setProperty("totalChunks", Integer.toString(requested.totalChunks()));
        try (OutputStream output = Files.newOutputStream(manifest, StandardOpenOption.CREATE_NEW)) {
            properties.store(output, "Bookshelf cover archive chunk upload");
        }
    }

    private static void writeChunk(Path uploadDirectory,
                                   int chunkIndex,
                                   long expectedSize,
                                   InputStream inputStream) throws IOException {
        Path destination = chunkPath(uploadDirectory, chunkIndex);
        Path temporary = uploadDirectory.resolve(String.format(Locale.ROOT, "%08d.tmp", chunkIndex));
        long written = 0L;
        byte[] buffer = new byte[BUFFER_SIZE];
        try (OutputStream output = Files.newOutputStream(
                temporary, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
            int read;
            while ((read = inputStream.read(buffer)) != -1) {
                written += read;
                if (written > expectedSize) {
                    throw new CoverArchiveException("표지 ZIP 청크 크기가 올바르지 않습니다.");
                }
                output.write(buffer, 0, read);
            }
        } catch (RuntimeException | IOException e) {
            Files.deleteIfExists(temporary);
            throw e;
        }
        if (written != expectedSize) {
            Files.deleteIfExists(temporary);
            throw new CoverArchiveException("표지 ZIP 청크 크기가 올바르지 않습니다.");
        }
        Files.move(temporary, destination, StandardCopyOption.REPLACE_EXISTING);
    }

    private static Path chunkPath(Path uploadDirectory, int chunkIndex) {
        return uploadDirectory.resolve(String.format(Locale.ROOT, "%08d.part", chunkIndex));
    }

    private static int countUploadedChunks(Path uploadDirectory, int totalChunks) {
        int count = 0;
        for (int index = 0; index < totalChunks; index++) {
            if (Files.isRegularFile(chunkPath(uploadDirectory, index))) {
                count++;
            }
        }
        return count;
    }

    private static boolean allChunksPresent(Path uploadDirectory, int totalChunks) {
        return uploadDirectory != null && Files.isDirectory(uploadDirectory)
                && countUploadedChunks(uploadDirectory, totalChunks) == totalChunks;
    }

    private static void assembleChunks(Path uploadDirectory,
                                       Path assembledArchive,
                                       int totalChunks,
                                       long expectedSize) throws IOException {
        long assembledSize = 0L;
        byte[] buffer = new byte[BUFFER_SIZE];
        try (OutputStream output = Files.newOutputStream(
                assembledArchive, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            for (int index = 0; index < totalChunks; index++) {
                Path chunk = chunkPath(uploadDirectory, index);
                try (InputStream input = Files.newInputStream(chunk)) {
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        assembledSize += read;
                        if (assembledSize > expectedSize) {
                            throw new CoverArchiveException("재조립한 표지 ZIP 크기가 올바르지 않습니다.");
                        }
                        output.write(buffer, 0, read);
                    }
                }
            }
        }
        if (assembledSize != expectedSize) {
            throw new CoverArchiveException("재조립한 표지 ZIP 크기가 올바르지 않습니다.");
        }
    }

    private void cleanupAbandonedChunkUploads() {
        Instant cutoff = Instant.now().minus(ABANDONED_UPLOAD_TTL);
        chunkJobStates.entrySet().removeIf(entry -> entry.getValue().updatedAt().isBefore(cutoff));
        if (!Files.isDirectory(chunkUploadRoot)) return;
        try (var uploads = Files.list(chunkUploadRoot)) {
            uploads.filter(Files::isDirectory).forEach(directory -> {
                try {
                    if (Files.getLastModifiedTime(directory).toInstant().isBefore(cutoff)) {
                        deleteStagingDirectory(directory);
                    }
                } catch (IOException ignored) {
                    // Best-effort cleanup of abandoned uploads.
                }
            });
        } catch (IOException ignored) {
            // Best-effort cleanup of abandoned uploads.
        }
    }

    private static void validateUpload(String originalFilename, long fileSize, long maxUploadBytes) {
        String filename = originalFilename == null ? "" : originalFilename.toLowerCase(Locale.ROOT);
        if (!filename.endsWith(".zip")) {
            throw new CoverArchiveException("표지 백업은 .zip 파일만 업로드할 수 있습니다.");
        }
        if (fileSize <= 0) {
            throw new CoverArchiveException("업로드할 표지 ZIP 파일을 선택해 주세요.");
        }
        if (fileSize > maxUploadBytes) {
            throw new CoverArchiveException(maxUploadBytes == MAX_UPLOAD_BYTES
                    ? "표지 ZIP 파일은 500MB 이하만 업로드할 수 있습니다. 더 큰 파일은 청크 업로드를 사용해 주세요."
                    : "청크 업로드 표지 ZIP 파일은 2GB 이하만 지원합니다.");
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

    private record ChunkUploadMetadata(String originalFilename, long totalSize, int totalChunks) {
    }

    private record ChunkJobState(ChunkUploadResult result, Instant updatedAt) {
    }

    public record ChunkUploadResult(
            boolean completed,
            boolean processing,
            int uploadedChunks,
            int totalChunks,
            ImportResult importResult,
            String errorMessage
    ) {
        public boolean successful() {
            return errorMessage == null;
        }

        static ChunkUploadResult uploading(int uploadedChunks, int totalChunks) {
            return new ChunkUploadResult(false, false, uploadedChunks, totalChunks, null, null);
        }

        static ChunkUploadResult processing(int totalChunks) {
            return new ChunkUploadResult(false, true, totalChunks, totalChunks, null, null);
        }

        static ChunkUploadResult completed(int totalChunks, ImportResult importResult) {
            return new ChunkUploadResult(true, false, totalChunks, totalChunks, importResult, null);
        }

        static ChunkUploadResult failed(int totalChunks, String errorMessage) {
            return new ChunkUploadResult(false, false, totalChunks, totalChunks, null, errorMessage);
        }

        public int percent() {
            return totalChunks <= 0 ? 0 : (int) ((long) uploadedChunks * 100 / totalChunks);
        }

        public String message() {
            if (completed && importResult != null) return importResult.summary();
            if (errorMessage != null) return errorMessage;
            if (processing) return "표지 ZIP 업로드 완료: 서버에서 압축 검증 및 복원 중입니다.";
            return "표지 ZIP 업로드 중: " + uploadedChunks + "/" + totalChunks + " 청크";
        }
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
