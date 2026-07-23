package com.example.bookshelf.config;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

class AsyncConfigTest {

    @Test
    void aladinFetchExecutor_limitsConcurrentRequestsToTwo() {
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) new AsyncConfig().aladinFetchExecutor();
        try {
            assertThat(executor.getCorePoolSize()).isEqualTo(2);
            assertThat(executor.getMaxPoolSize()).isEqualTo(2);
        } finally {
            executor.destroy();
        }
    }

    @Test
    void coverArchiveExecutor_waitsForRestoreTasksDuringShutdown() throws Exception {
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) new AsyncConfig().coverArchiveExecutor();
        try {
            Future<Boolean> daemon = executor.submit(() -> Thread.currentThread().isDaemon());

            assertThat(daemon.get()).isFalse();
            assertThat(ReflectionTestUtils.getField(executor, "waitForTasksToCompleteOnShutdown"))
                    .isEqualTo(true);
            assertThat(ReflectionTestUtils.getField(executor, "awaitTerminationMillis"))
                    .isEqualTo(1_800_000L);
        } finally {
            executor.destroy();
        }
    }
}
