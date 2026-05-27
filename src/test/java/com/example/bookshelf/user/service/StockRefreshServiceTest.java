package com.example.bookshelf.user.service;

import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class StockRefreshServiceTest {

    @Mock private BookVolumeRepository bookVolumeRepository;
    @Mock private BranchInventoryRepository branchInventoryRepository;
    @Mock private AladinUsedStockService aladinUsedStockService;

    private StockRefreshService stockRefreshService;

    @BeforeEach
    void setUp() {
        // Use a direct executor for both fetching and the main job to make tests synchronous
        Executor directExecutor = Runnable::run;
        stockRefreshService = new StockRefreshService(
                bookVolumeRepository,
                branchInventoryRepository,
                aladinUsedStockService,
                directExecutor
        ) {
            // Override the internal refreshExecutor to also be synchronous
            {
                try {
                    var field = StockRefreshService.class.getDeclaredField("refreshExecutor");
                    field.setAccessible(true);
                    field.set(this, directExecutor);
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }
        };
    }

    @Test
    void startStockRefreshJob_rebuildsSummaryAfterProcessing() {
        when(bookVolumeRepository.countUnpurchasedVolumes()).thenReturn(1);
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(0, 100)).thenReturn(List.of(
                new BookVolume(1, 1, 10, "9781234567890", "책1", null, null, false, "1")
        ));
        when(bookVolumeRepository.findUnpurchasedVolumesAfterId(1, 100)).thenReturn(List.of());
        when(aladinUsedStockService.findUsedStocksByIsbn13("9781234567890")).thenReturn(List.of(
                new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "책1")
        ));

        var result = stockRefreshService.startStockRefreshJob();
        assertThat(result.started()).isTrue();
        // No sleep needed because executors are synchronous

        verify(branchInventoryRepository).deleteBranchBooksByBookAndVolume(10, 1);
        verify(branchInventoryRepository).insertBranchBooks(10, "책1", 1, List.of(new AladinBranchStock("B1", "강남점", "A", "link", null, "9000", 1, "책1")));
        verify(branchInventoryRepository).rebuildBranchInventorySummary();
    }
}
