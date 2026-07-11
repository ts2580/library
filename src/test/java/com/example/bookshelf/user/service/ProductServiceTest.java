package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProductServiceTest {

    @TempDir Path tempDir;

    @Mock private BookDataRepository bookDataRepository;
    @Mock private BookVolumeRepository bookVolumeRepository;
    @Mock private BranchInventoryRepository branchInventoryRepository;
    @Mock private AladinUsedStockService aladinUsedStockService;

    @InjectMocks
    private ProductService productService;

    private ProductService.ProductImportCommand command;

    @BeforeEach
    void setUp() {
        command = new ProductService.ProductImportCommand(
                "테스트 책", "테스터", "cover-url", "9781234567890", null,
                "10000", "설명", null, null, null, null
        );
    }

    @Test
    void importProduct_returnsError_whenIsbnAlreadyExists() {
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(true);

        var result = productService.importProduct(command);

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("이미 같은 ISBN");
        verify(bookDataRepository, never()).insertBook(anyString(), anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void importProduct_returnsSuccess_whenNewBookCreated() {
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);
        when(bookDataRepository.findBookIdByNameAndAuthor("테스트 책", "테스터")).thenReturn(null);
        when(bookDataRepository.insertBook("테스트 책", "테스터", "설명", "cover-url", null, null)).thenReturn(10);
        when(aladinUsedStockService.lookupUsedStocksByIsbn13("9781234567890")).thenReturn(
                AladinUsedStockService.StockLookupResult.success(List.of(
                        new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "테스트 책")
                )));

        var result = productService.importProduct(command);

        assertThat(result.success()).isTrue();
        verify(bookVolumeRepository).insertVolume(10, 1, "9781234567890", "테스트 책", "cover-url", "10000", "설명");
        verify(branchInventoryRepository).insertBranchBooks(anyInt(), anyInt(), anyString(), anyInt(), anyList());
        verify(branchInventoryRepository).rebuildBranchInventorySummary();
    }

    @Test
    void importProduct_stillSucceeds_whenImportedStockLookupFails() {
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);
        when(bookDataRepository.findBookIdByNameAndAuthor("테스트 책", "테스터")).thenReturn(null);
        when(bookDataRepository.insertBook("테스트 책", "테스터", "설명", "cover-url", null, null)).thenReturn(10);
        when(aladinUsedStockService.lookupUsedStocksByIsbn13("9781234567890")).thenReturn(
                AladinUsedStockService.StockLookupResult.failure("network down"));

        var result = productService.importProduct(command);

        assertThat(result.success()).isTrue();
        assertThat(result.message()).contains("재고 조회 실패");
        verify(bookVolumeRepository).insertVolume(10, 1, "9781234567890", "테스트 책", "cover-url", "10000", "설명");
        verify(branchInventoryRepository, never()).insertBranchBooks(anyInt(), anyInt(), anyString(), anyInt(), anyList());
        verify(branchInventoryRepository, never()).rebuildBranchInventorySummary();
    }

    @Test
    void importProduct_returnsError_whenDuplicateKeyRaised() {
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);
        when(bookDataRepository.findBookIdByNameAndAuthor("테스트 책", "테스터")).thenReturn(null);
        when(bookDataRepository.insertBook("테스트 책", "테스터", "설명", "cover-url", null, null)).thenReturn(10);
        doThrow(new DuplicateKeyException("dup")).when(bookVolumeRepository).insertVolume(10, 1, "9781234567890", "테스트 책", "cover-url", "10000", "설명");

        var result = productService.importProduct(command);

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("추가가 중단");
    }

    @Test
    void importProduct_updatesExistingBookMetadata_whenTargetBookSelected() {
        var existingBookCommand = new ProductService.ProductImportCommand(
                "테스트 책", "테스터", "cover-url", "9781234567890", null,
                "10000", "설명", 7, 3, "만화", "12"
        );
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);
        when(bookDataRepository.findBookById(7)).thenReturn(new Book(7, "기존 책", "기존 저자", "기존 설명", "10", "소설", "old-cover", null, null));
        when(aladinUsedStockService.lookupUsedStocksByIsbn13("9781234567890")).thenReturn(
                AladinUsedStockService.StockLookupResult.success(List.of()));

        var result = productService.importProduct(existingBookCommand);

        assertThat(result.success()).isTrue();
        verify(bookDataRepository).updateBook(7, "기존 책", "기존 저자", "기존 설명", "old-cover", "만화", "12");
        verify(bookVolumeRepository).insertVolume(7, 3, "9781234567890", "테스트 책", "cover-url", "10000", "설명");
        assertThat(result.success()).isTrue();
    }

    @Test
    void persistCoverImage_rejectsNonAladinHostsWithoutWritingAFile() {
        ReflectionTestUtils.setField(productService, "coverStorageDir", tempDir.toString());

        String result = productService.persistCoverImage("http://127.0.0.1/private.jpg", "../../outside");

        assertThat(result).isEqualTo("http://127.0.0.1/private.jpg");
        assertThat(tempDir).isEmptyDirectory();
    }

    @Test
    void coverFileKey_isSanitizedBeforeItBecomesAPath() {
        String sanitized = ReflectionTestUtils.invokeMethod(productService, "sanitizeCoverFileKey", "../../evil\\name");

        assertThat(sanitized).doesNotContain("/", "\\", "..");
    }
}
