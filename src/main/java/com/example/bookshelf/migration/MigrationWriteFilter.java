package com.example.bookshelf.migration;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.Set;

public class MigrationWriteFilter extends OncePerRequestFilter {
    private final MigrationWriteGate gate;
    public MigrationWriteFilter(MigrationWriteGate gate) { this.gate = gate; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        boolean exempt = Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())
                || path.equals("/user/profile/next-migration/start")
                || path.equals("/user/login") || path.equals("/user/logout");
        if (exempt) { chain.doFilter(request, response); return; }
        if (!gate.enterWrite()) {
            response.setStatus(423);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"error\":\"Next.js 이전 중이거나 이전이 완료되어 기존 책장은 읽기 전용입니다.\"}");
            return;
        }
        try { chain.doFilter(request, response); }
        finally { gate.leaveWrite(); }
    }
}
