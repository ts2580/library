package com.example.bookshelf.user.backup;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CoverArchiveServiceTest {

    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xD9};
    private static final byte[] PNG = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};

    @TempDir Path tempDir;

    @Test
    void writeArchive_includesOnlyExistingLocalCoversReferencedByOwner() throws Exception {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        when(repository.findLocalCoverUrlsForOwner(7)).thenReturn(List.of(
                "/covers/book.jpg", "/covers/volume.png", "/covers/missing.jpg", "https://example.com/remote.jpg"
        ));
        Files.write(tempDir.resolve("book.jpg"), JPEG);
        Files.write(tempDir.resolve("volume.png"), PNG);
        CoverArchiveService service = new CoverArchiveService(repository, tempDir.toString());
        ByteArrayOutputStream output = new ByteArrayOutputStream();

        service.writeArchive(7, output);

        assertThat(readZip(output.toByteArray()))
                .containsEntry("covers/book.jpg", JPEG)
                .containsEntry("covers/volume.png", PNG)
                .doesNotContainKey("covers/missing.jpg");
    }

    @Test
    void importArchive_restoresOnlyCurrentOwnersMissingReferencedCovers() throws Exception {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        when(repository.findLocalCoverUrlsForOwner(7)).thenReturn(List.of("/covers/book.jpg", "/covers/existing.png"));
        Files.write(tempDir.resolve("existing.png"), new byte[]{1, 2, 3});
        CoverArchiveService service = new CoverArchiveService(repository, tempDir.toString());
        byte[] archive = zip(Map.of(
                "covers/book.jpg", JPEG,
                "covers/existing.png", PNG,
                "covers/not-owned.jpg", JPEG
        ));

        var result = service.importArchive(7, "covers.zip", archive.length, new ByteArrayInputStream(archive));

        assertThat(result).isEqualTo(new CoverArchiveService.ImportResult(1, 1, 1));
        assertThat(Files.readAllBytes(tempDir.resolve("book.jpg"))).containsExactly(JPEG);
        assertThat(Files.readAllBytes(tempDir.resolve("existing.png"))).containsExactly(1, 2, 3);
        assertThat(tempDir.resolve("not-owned.jpg")).doesNotExist();
        verify(repository).markLocalCoverAvailableForOwner(7, "/covers/book.jpg");
        verify(repository).markLocalCoverAvailableForOwner(7, "/covers/existing.png");
    }

    @Test
    void importArchive_rejectsPathTraversalBeforeWritingFiles() throws Exception {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        when(repository.findLocalCoverUrlsForOwner(7)).thenReturn(List.of("/covers/book.jpg"));
        CoverArchiveService service = new CoverArchiveService(repository, tempDir.toString());
        byte[] archive = zip(Map.of("../book.jpg", JPEG));

        assertThatThrownBy(() -> service.importArchive(
                7, "covers.zip", archive.length, new ByteArrayInputStream(archive)
        )).isInstanceOf(CoverArchiveService.CoverArchiveException.class)
                .hasMessageContaining("안전하지 않은 경로");

        assertThat(tempDir.resolve("book.jpg")).doesNotExist();
        assertThat(tempDir.getParent().resolve("book.jpg")).doesNotExist();
    }

    @Test
    void importArchive_rejectsFilesWithoutSupportedImageSignature() throws Exception {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        when(repository.findLocalCoverUrlsForOwner(7)).thenReturn(List.of("/covers/book.jpg"));
        CoverArchiveService service = new CoverArchiveService(repository, tempDir.toString());
        byte[] archive = zip(Map.of("covers/book.jpg", "not-an-image".getBytes()));

        assertThatThrownBy(() -> service.importArchive(
                7, "covers.zip", archive.length, new ByteArrayInputStream(archive)
        )).isInstanceOf(CoverArchiveService.CoverArchiveException.class)
                .hasMessageContaining("이미지 파일이 아닌");

        assertThat(tempDir.resolve("book.jpg")).doesNotExist();
    }

    @Test
    void importArchiveChunk_reassemblesMultipleChunksBeforeRestoring() throws Exception {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        when(repository.findLocalCoverUrlsForOwner(7)).thenReturn(List.of("/covers/book.jpg"));
        CoverArchiveService service = new CoverArchiveService(repository, tempDir.toString());
        byte[] image = new byte[CoverArchiveService.CHUNK_BYTES + 1024];
        new Random(7).nextBytes(image);
        image[0] = (byte) 0xFF;
        image[1] = (byte) 0xD8;
        image[2] = (byte) 0xFF;
        byte[] archive = zip(Map.of("covers/book.jpg", image));
        assertThat(archive.length).isGreaterThan(CoverArchiveService.CHUNK_BYTES);
        int totalChunks = (int) Math.ceil((double) archive.length / CoverArchiveService.CHUNK_BYTES);
        String uploadId = "c83454f4-c137-46a6-b558-66b1ca2de204";

        var first = service.importArchiveChunk(
                7, uploadId, "covers.zip", archive.length, totalChunks, 0,
                CoverArchiveService.CHUNK_BYTES,
                new ByteArrayInputStream(archive, 0, CoverArchiveService.CHUNK_BYTES)
        );
        int remaining = archive.length - CoverArchiveService.CHUNK_BYTES;
        var second = service.importArchiveChunk(
                7, uploadId, "covers.zip", archive.length, totalChunks, 1, remaining,
                new ByteArrayInputStream(archive, CoverArchiveService.CHUNK_BYTES, remaining)
        );

        assertThat(first.completed()).isFalse();
        assertThat(first.percent()).isEqualTo(50);
        assertThat(second.completed()).isTrue();
        assertThat(second.importResult()).isEqualTo(new CoverArchiveService.ImportResult(1, 0, 0));
        assertThat(Files.size(tempDir.resolve("book.jpg"))).isEqualTo(image.length);
        assertThat(tempDir.getParent().resolve(".cover-uploads").resolve("7-" + uploadId)).doesNotExist();
        verify(repository).markLocalCoverAvailableForOwner(7, "/covers/book.jpg");
    }

    @Test
    void importArchiveChunk_rejectsInvalidChunkSizeBeforeWriting() {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        CoverArchiveService service = new CoverArchiveService(repository, tempDir.toString());

        assertThatThrownBy(() -> service.importArchiveChunk(
                7, "c83454f4-c137-46a6-b558-66b1ca2de204", "covers.zip",
                CoverArchiveService.CHUNK_BYTES + 1L, 2, 0, 3,
                new ByteArrayInputStream(new byte[]{1, 2, 3})
        )).isInstanceOf(CoverArchiveService.CoverArchiveException.class)
                .hasMessageContaining("청크 크기");
    }

    @Test
    void importArchiveChunk_runsRestoreAsynchronouslyAndExposesCompletionStatus() throws Exception {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        when(repository.findLocalCoverUrlsForOwner(7)).thenReturn(List.of("/covers/book.jpg"));
        AtomicReference<Runnable> scheduled = new AtomicReference<>();
        CoverArchiveService service = new CoverArchiveService(repository, tempDir.toString(), scheduled::set);
        byte[] archive = zip(Map.of("covers/book.jpg", JPEG));
        String uploadId = "018990a1-4458-7e8e-a73d-675a87f40d9d";

        var accepted = service.importArchiveChunk(
                7, uploadId, "covers.zip", archive.length, 1, 0, archive.length,
                new ByteArrayInputStream(archive)
        );

        assertThat(accepted.processing()).isTrue();
        assertThat(accepted.completed()).isFalse();
        assertThat(tempDir.resolve("book.jpg")).doesNotExist();

        scheduled.get().run();
        var completed = service.getArchiveChunkStatus(7, uploadId);

        assertThat(completed.completed()).isTrue();
        assertThat(completed.processing()).isFalse();
        assertThat(completed.importResult()).isEqualTo(new CoverArchiveService.ImportResult(1, 0, 0));
        assertThat(Files.readAllBytes(tempDir.resolve("book.jpg"))).containsExactly(JPEG);
    }

    @Test
    void importArchiveChunk_limitsConcurrentIncompleteUploadsPerOwner() {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        CoverArchiveService service = new CoverArchiveService(
                repository,
                tempDir.resolve("covers").toString(),
                Runnable::run,
                1,
                CoverArchiveService.MAX_STORED_CHUNK_BYTES_PER_OWNER
        );
        byte[] firstChunk = new byte[CoverArchiveService.CHUNK_BYTES];

        service.importArchiveChunk(
                7, "018990a1-4458-4e8e-a73d-675a87f40d9d", "first.zip",
                CoverArchiveService.CHUNK_BYTES + 1L, 2, 0, CoverArchiveService.CHUNK_BYTES,
                new ByteArrayInputStream(firstChunk)
        );

        assertThatThrownBy(() -> service.importArchiveChunk(
                7, "118990a1-4458-4e8e-a73d-675a87f40d9d", "second.zip",
                CoverArchiveService.CHUNK_BYTES + 1L, 2, 0, CoverArchiveService.CHUNK_BYTES,
                new ByteArrayInputStream(firstChunk)
        )).isInstanceOf(CoverArchiveService.CoverArchiveException.class)
                .hasMessageContaining("동시에 진행");
    }

    @Test
    void importArchiveChunk_removesCurrentUploadWhenOwnerByteLimitIsExceeded() {
        BookshelfBackupRepository repository = mock(BookshelfBackupRepository.class);
        CoverArchiveService service = new CoverArchiveService(
                repository,
                tempDir.resolve("covers").toString(),
                Runnable::run,
                2,
                CoverArchiveService.CHUNK_BYTES
        );
        String uploadId = "218990a1-4458-4e8e-a73d-675a87f40d9d";
        byte[] firstChunk = new byte[CoverArchiveService.CHUNK_BYTES];

        service.importArchiveChunk(
                7, uploadId, "covers.zip", CoverArchiveService.CHUNK_BYTES + 1L,
                2, 0, CoverArchiveService.CHUNK_BYTES, new ByteArrayInputStream(firstChunk)
        );

        assertThatThrownBy(() -> service.importArchiveChunk(
                7, uploadId, "covers.zip", CoverArchiveService.CHUNK_BYTES + 1L,
                2, 1, 1L, new ByteArrayInputStream(new byte[]{1})
        )).isInstanceOf(CoverArchiveService.CoverArchiveException.class)
                .hasMessageContaining("임시 저장 한도");
        assertThat(tempDir.resolve(".cover-uploads").resolve("7-" + uploadId)).doesNotExist();
    }

    private static byte[] zip(Map<String, byte[]> files) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            for (Map.Entry<String, byte[]> file : files.entrySet()) {
                zip.putNextEntry(new ZipEntry(file.getKey()));
                zip.write(file.getValue());
                zip.closeEntry();
            }
        }
        return output.toByteArray();
    }

    private static Map<String, byte[]> readZip(byte[] archive) throws Exception {
        Map<String, byte[]> files = new LinkedHashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                files.put(entry.getName(), zip.readAllBytes());
                zip.closeEntry();
            }
        }
        return files;
    }
}
