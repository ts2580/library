package com.example.bookshelf.web;

import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.service.BookCatalogService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.servlet.mvc.support.RedirectAttributesModelMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BookshelfControllerTest {

    @Mock private BookCatalogService bookCatalogService;
    @Mock private BookDataRepository bookDataRepository;
    @Mock private BookVolumeRepository bookVolumeRepository;

    @Test
    void createBook_insertsManualBookAndRedirectsToDetail() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();
        when(bookDataRepository.insertBook("수동 책", "저자", "설명", "cover", "만화", "12")).thenReturn(42);

        String view = controller.createBook("수동 책", "저자", "설명", "cover", "만화", "12", redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books/42");
        assertThat(redirectAttributes.getFlashAttributes().get("success")).isEqualTo("책을 추가했습니다.");
        verify(bookDataRepository).insertBook("수동 책", "저자", "설명", "cover", "만화", "12");
    }

    @Test
    void createBook_rejectsBlankTitle() {
        BookshelfController controller = new BookshelfController(bookCatalogService, bookDataRepository, bookVolumeRepository);
        RedirectAttributesModelMap redirectAttributes = new RedirectAttributesModelMap();

        String view = controller.createBook(" ", null, null, null, null, null, redirectAttributes);

        assertThat(view).isEqualTo("redirect:/books");
        assertThat(redirectAttributes.getFlashAttributes().get("error")).isEqualTo("책 제목을 입력해 주세요.");
        verify(bookDataRepository, never()).insertBook(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }
}
