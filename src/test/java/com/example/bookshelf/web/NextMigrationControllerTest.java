package com.example.bookshelf.web;

import com.example.bookshelf.config.SecurityConfig;
import com.example.bookshelf.migration.NextMigrationService;
import com.example.bookshelf.user.repository.MemberRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(NextMigrationController.class)
@Import(SecurityConfig.class)
class NextMigrationControllerTest {
    @Autowired MockMvc mvc;
    @MockBean NextMigrationService service;
    @MockBean MemberRepository members;
    @MockBean AuthSessionHelper authSessionHelper;

    @Test
    void onlyAdminCanReadStatusOrStartWithCsrf() throws Exception {
        mvc.perform(get("/user/profile/next-migration/status")).andExpect(status().is3xxRedirection());
        mvc.perform(get("/user/profile/next-migration/status").with(user("regular").roles("USER"))).andExpect(status().isForbidden());
        mvc.perform(post("/user/profile/next-migration/start").with(user("trstyq").roles("ADMIN"))).andExpect(status().isForbidden());
        mvc.perform(post("/user/profile/next-migration/start").with(user("regular").roles("USER")).with(csrf())).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
    @Test
    void startUsesAuthenticatedNameAndRejectsDuplicate() throws Exception {
        when(service.start("trstyq")).thenReturn(new NextMigrationService.View("WAITING", "대기", 1, true, true, true, 25648, "", null));
        mvc.perform(post("/user/profile/next-migration/start").with(user("trstyq").roles("ADMIN")).with(csrf()).param("owner", "attacker"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.readOnly").value(true));
        verify(service).start("trstyq");
        when(service.start("trstyq")).thenThrow(new IllegalStateException("이미 이전 중입니다."));
        mvc.perform(post("/user/profile/next-migration/start").with(user("trstyq").roles("ADMIN")).with(csrf()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("이미 이전 중입니다."));
    }
}
