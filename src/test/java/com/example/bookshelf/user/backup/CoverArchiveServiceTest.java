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
