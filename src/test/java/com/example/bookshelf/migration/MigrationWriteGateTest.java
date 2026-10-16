package com.example.bookshelf.migration;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockFilterChain;
import static org.assertj.core.api.Assertions.assertThat;

class MigrationWriteGateTest {
    @Test
    void freezeRejectsNewWritesAndWaitsForExistingRequests() {
        var gate = new MigrationWriteGate();
        assertThat(gate.enterWrite()).isTrue();
        gate.freeze();
        assertThat(gate.enterWrite()).isFalse();
        assertThat(gate.drained()).isFalse();
        gate.leaveWrite();
        assertThat(gate.drained()).isTrue();
        gate.thaw();
        assertThat(gate.enterWrite()).isTrue();
        gate.leaveWrite();
    }
    @Test
    void frozenAppBlocksWritesButKeepsProfileAndMigrationReachable() throws Exception {
        var gate = new MigrationWriteGate(); gate.freeze();
        var filter = new MigrationWriteFilter(gate);
        var response = new MockHttpServletResponse();
        var chain = new MockFilterChain();
        filter.doFilter(new MockHttpServletRequest("POST", "/books"), response, chain);
        assertThat(response.getStatus()).isEqualTo(423);
        assertThat(chain.getRequest()).isNull();
        for (String path : new String[]{"/user/profile", "/user/profile/next-migration/status"}) {
            chain = new MockFilterChain();
            filter.doFilter(new MockHttpServletRequest("GET", path), new MockHttpServletResponse(), chain);
            assertThat(chain.getRequest()).isNotNull();
        }
        chain = new MockFilterChain();
        filter.doFilter(new MockHttpServletRequest("POST", "/user/profile/next-migration/start"), new MockHttpServletResponse(), chain);
        assertThat(chain.getRequest()).isNotNull();
    }
}
