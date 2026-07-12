package com.example.bookshelf.web;

import com.example.bookshelf.user.service.ProductSearchService;
import com.example.bookshelf.user.service.ProductService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class ProductControllerTest {

    @Mock private AuthSessionHelper authSessionHelper;
    @Mock private ProductSearchService productSearchService;
    @Mock private ProductService productService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new ProductController(authSessionHelper, productSearchService, productService)).build();
    }

    @Test
    void importProduct_ajaxRequestReturnsJsonWithoutRedirect() throws Exception {
        when(authSessionHelper.getMemberId(null)).thenReturn(17);
        when(productService.importProduct(any(ProductService.ProductImportCommand.class)))
                .thenReturn(ProductService.ProductImportResult.success("등록 완료: 외전"));

        mockMvc.perform(post("/products/import")
                        .header("X-Requested-With", "XMLHttpRequest")
                        .header("Accept", "application/json")
                        .param("title", "외전")
                        .param("isbn13", "9781234567890")
                        .param("volume", "3")
                        .param("sideStory", "true"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("등록 완료: 외전"));

        verify(productService).importProduct(new ProductService.ProductImportCommand(
                "외전", null, null, "9781234567890", null, null, null,
                null, 3, true, null, null, 17
        ));
    }
}
