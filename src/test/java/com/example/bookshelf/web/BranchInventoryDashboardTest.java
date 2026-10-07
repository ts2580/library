package com.example.bookshelf.web;

import com.example.bookshelf.config.SecurityConfig;
import com.example.bookshelf.user.model.BranchStockItem;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.user.service.StockRefreshService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(DashboardController.class)
@Import(SecurityConfig.class)
class BranchInventoryDashboardTest {
    @Autowired private MockMvc mockMvc;
    @MockBean private AuthSessionHelper authSessionHelper;
    @MockBean private BookVolumeRepository bookVolumeRepository;
    @MockBean private BranchInventoryRepository branchInventoryRepository;
    @MockBean private StockRefreshService stockRefreshService;
    @MockBean private MemberRepository memberRepository;

    @BeforeEach
    void setUp() {
        when(branchInventoryRepository.findBranchInventorySummaries()).thenReturn(List.of());
        when(stockRefreshService.getStockRefreshProgress()).thenReturn(StockRefreshService.StockRefreshProgress.idle());
    }

    @Test
    void emptySearchRendersFormWithoutLoadingAllStocks() throws Exception {
        mockMvc.perform(get("/dashboard/branches").with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(model().attribute("search", ""))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("재고 검색")));
        verify(branchInventoryRepository, never()).countStocksMatching(anyString());
        verify(branchInventoryRepository, never()).searchStocks(anyString(), anyInt(), anyInt());
    }

    @Test
    void searchRendersResultsAndPreservesKeywordInPagination() throws Exception {
        when(branchInventoryRepository.countStocksMatching("별의 책")).thenReturn(25);
        when(branchInventoryRepository.searchStocks("별의 책", 24, 0)).thenReturn(List.of(
                new BranchStockItem(1, "B1", "강남점", 1, "A", "별의 책", "별의 책 외전", "9780000000001", null, "9,000", null, null)));
        var result = mockMvc.perform(get("/dashboard/branches").param("search", " 별의 책 ")
                        .with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(model().attribute("stockCount", 25))
                .andExpect(model().attribute("stockTotalPages", 2)).andReturn();
        assertThat(result.getResponse().getContentAsString()).contains("별의 책 외전", "강남점", "9,000원", "page=2", "#stockSearch");
    }

    @Test
    void outOfRangePageIsClampedAndNoMatchesRenderEmptyState() throws Exception {
        when(branchInventoryRepository.countStocksMatching("책")).thenReturn(25);
        mockMvc.perform(get("/dashboard/branches").param("search", "책").param("page", "999")
                        .with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(model().attribute("stockPage", 2));
        verify(branchInventoryRepository).searchStocks("책", 24, 24);
        mockMvc.perform(get("/dashboard/branches").param("search", "없음").param("page", "-1")
                        .with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(model().attribute("stockPage", 1))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("검색 조건에 맞는 재고가 없습니다.")));
    }

    @Test
    void searchRetainsAdminAccessBoundary() throws Exception {
        mockMvc.perform(get("/dashboard/branches").param("search", "책"))
                .andExpect(status().is3xxRedirection());
        mockMvc.perform(get("/dashboard/branches").param("search", "책").with(user("regular").roles("USER")))
                .andExpect(status().isForbidden());
        verifyNoInteractions(branchInventoryRepository);
    }
}
