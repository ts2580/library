package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinApiService;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;

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

    @Mock private BookDataRepository bookDataRepository;
    @Mock private BookVolumeRepository bookVolumeRepository;
    @Mock private BranchInventoryRepository branchInventoryRepository;
    @Mock private AladinApiService aladinApiService;

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
        when(aladinApiService.findUsedStocksByIsbn13("9781234567890")).thenReturn(List.of(new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "테스트 책")));

        var result = productService.importProduct(command);

        assertThat(result.success()).isTrue();
        verify(bookVolumeRepository).insertVolume(10, 1, "9781234567890", "테스트 책", "cover-url", "10000");
        verify(branchInventoryRepository).insertBranchBooks(anyInt(), anyString(), anyInt(), anyList());
        verify(branchInventoryRepository).rebuildBranchInventorySummary();
    }

    @Test
    void importProduct_returnsError_whenDuplicateKeyRaised() {
        when(bookVolumeRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);
        when(bookDataRepository.findBookIdByNameAndAuthor("테스트 책", "테스터")).thenReturn(null);
        when(bookDataRepository.insertBook("테스트 책", "테스터", "설명", "cover-url", null, null)).thenReturn(10);
        doThrow(new DuplicateKeyException("dup")).when(bookVolumeRepository).insertVolume(10, 1, "9781234567890", "테스트 책", "cover-url", "10000");

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
        when(aladinApiService.findUsedStocksByIsbn13("9781234567890")).thenReturn(List.of());

        var result = productService.importProduct(existingBookCommand);

        assertThat(result.success()).isTrue();
        verify(bookDataRepository).updateBook(7, "기존 책", "기존 저자", "기존 설명", "old-cover", "만화", "12");
        verify(bookVolumeRepository).insertVolume(7, 3, "9781234567890", "테스트 책", "cover-url", "10000");
    }

    @Test
    void startStockRefreshJob_rebuildsSummaryAfterProcessing() {
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(1);
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(0, 100)).thenReturn(List.of(
                new BookVolume(1, 1, 10, "9781234567890", "책1", null, null, false, "1")
        ));
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(1, 100)).thenReturn(List.of());
        when(aladinApiService.findUsedStocksByIsbn13("9781234567890")).thenReturn(List.of(
                new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "책1")
        ));

        var result = productService.startStockRefreshJob();
        assertThat(result.started()).isTrue();

        try { Thread.sleep(200); } catch (InterruptedException ignored) {}

        verify(branchInventoryRepository).deleteBranchBooksByBookAndVolume(10, 1);
        verify(branchInventoryRepository).insertBranchBooks(10, "책1", 1, List.of(new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "책1")));
        verify(branchInventoryRepository).rebuildBranchInventorySummary();
    }
}
