package com.example.bookshelf.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class ManualCoverUploadLimitFilter extends OncePerRequestFilter {

    static final long MAX_MANUAL_COVER_REQUEST_BYTES = 9L * 1024 * 1024;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        if (!isManualCoverMultipartRequest(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        long contentLength = request.getContentLengthLong();
        if (contentLength < 0 || contentLength > MAX_MANUAL_COVER_REQUEST_BYTES) {
            response.sendError(
                    HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE,
                    "수동 표지 이미지 업로드 요청은 9MB 이하여야 합니다."
            );
            return;
        }
        filterChain.doFilter(request, response);
    }

    private boolean isManualCoverMultipartRequest(HttpServletRequest request) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) {
            return false;
        }
        String contentType = request.getContentType();
        if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT)
                .startsWith("multipart/form-data")) {
            return false;
        }
        String requestUri = request.getRequestURI();
        String contextPath = request.getContextPath();
        String path = contextPath.isEmpty() ? requestUri : requestUri.substring(contextPath.length());
        return path.equals("/books") || path.startsWith("/books/") || path.startsWith("/books;");
    }
}
