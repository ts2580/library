package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinApiService;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookRepository;
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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProductServiceTest {

    @Mock
    private BookRepository bookRepository;

    @Mock
    private AladinApiService aladinApiService;

    @InjectMocks
    private ProductService productService;

    private ProductService.ProductImportCommand command;

    @BeforeEach
    void setUp() {
        command = new ProductService.ProductImportCommand(
                "테스트 책",
                "테스터",
                "cover-url",
                "9781234567890",
                null,
                "10000",
                "설명",
                null
        );
    }

    @Test
    void importProduct_returnsError_whenIsbnAlreadyExists() {
        when(bookRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(true);

        var result = productService.importProduct(command);

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("이미 같은 ISBN");
        verify(bookRepository, never()).insertBook(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void importProduct_returnsSuccess_whenNewBookCreated() {
        when(bookRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);
        when(bookRepository.findBookIdByNameAndAuthor("테스트 책", "테스터")).thenReturn(null);
        when(bookRepository.insertBook("테스트 책", "테스터", "설명", "cover-url", null)).thenReturn(10);
        when(bookRepository.nextVolumeSeq(10)).thenReturn(1);
        when(aladinApiService.findUsedStocksByIsbn13("9781234567890"))
                .thenReturn(List.of(new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "테스트 책")));

        var result = productService.importProduct(command);

        assertThat(result.success()).isTrue();
        verify(bookRepository).insertVolume(10, 1, "9781234567890", "테스트 책", "cover-url", "10000");
        verify(bookRepository).insertBranchBooks(anyInt(), anyString(), anyInt(), org.mockito.ArgumentMatchers.anyList());
    }

    @Test
    void importProduct_returnsError_whenDuplicateKeyRaised() {
        when(bookRepository.existsVolumeByIsbn13("9781234567890")).thenReturn(false);
        when(bookRepository.findBookIdByNameAndAuthor("테스트 책", "테스터")).thenReturn(null);
        when(bookRepository.insertBook("테스트 책", "테스터", "설명", "cover-url", null)).thenReturn(10);
        when(bookRepository.nextVolumeSeq(10)).thenReturn(1);
        doThrow(new DuplicateKeyException("dup"))
                .when(bookRepository).insertVolume(10, 1, "9781234567890", "테스트 책", "cover-url", "10000");

        var result = productService.importProduct(command);

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("추가가 중단");
    }

    @Test
    void refreshAllStocks_returnsSummary() {
        when(bookRepository.findUnpurchasedVolumes()).thenReturn(List.of(
                new BookVolume(1, 1, 10, "9781234567890", "책1", null, null, false, "1"),
                new BookVolume(2, 2, 10, "9781111111111", "책2", null, null, false, "2")
        ));
        when(aladinApiService.findUsedStocksByIsbn13("9781234567890"))
                .thenReturn(List.of(new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "책1")));
        when(aladinApiService.findUsedStocksByIsbn13("9781111111111"))
                .thenReturn(List.of());

        var result = productService.refreshAllStocks();

        assertThat(result.total()).isEqualTo(2);
        assertThat(result.success()).isEqualTo(1);
        assertThat(result.empty()).isEqualTo(1);
        assertThat(result.fail()).isEqualTo(0);
        verify(bookRepository).deleteBranchBooksByBookAndVolume(10, 1);
    }
}
