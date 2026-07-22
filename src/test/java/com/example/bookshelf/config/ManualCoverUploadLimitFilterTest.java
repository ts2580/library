package com.example.bookshelf.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class ManualCoverUploadLimitFilterTest {

    private final ManualCoverUploadLimitFilter filter = new ManualCoverUploadLimitFilter();

    @Test
    void rejectsOversizedManualCoverRequestBeforeMultipartParsing() throws Exception {
        MockHttpServletRequest request = multipartPost(
                "/books/12/volumes", ManualCoverUploadLimitFilter.MAX_MANUAL_COVER_REQUEST_BYTES + 1
        );
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    void rejectsManualCoverRequestWithoutKnownLength() throws Exception {
        MockHttpServletRequest request = multipartPost("/books", -1);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    void allowsBoundedManualCoverRequest() throws Exception {
        MockHttpServletRequest request = multipartPost(
                "/books/12", ManualCoverUploadLimitFilter.MAX_MANUAL_COVER_REQUEST_BYTES
        );
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
    }

    @Test
    void doesNotApplyManualCoverLimitToChunkedArchiveEndpoint() throws Exception {
        MockHttpServletRequest request = multipartPost(
                "/user/profile/covers/archive/upload/chunk",
                ManualCoverUploadLimitFilter.MAX_MANUAL_COVER_REQUEST_BYTES + 1
        );
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
    }

    private static MockHttpServletRequest multipartPost(String path, long contentLength) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path) {
            @Override
            public long getContentLengthLong() {
                return contentLength;
            }
        };
        request.setContentType("multipart/form-data; boundary=test");
        return request;
    }
}
