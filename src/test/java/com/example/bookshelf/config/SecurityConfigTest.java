package com.example.bookshelf.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecurityConfigTest {

    @Test
    void prodRejectsDefaultPlaceholderAndShortRememberMeKeys() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("prod");

        assertThatThrownBy(() -> SecurityConfig.validateRememberMeKey(
                environment, "bookshelf-dev-remember-me-change-me"
        )).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> SecurityConfig.validateRememberMeKey(
                environment, "change-this-long-random-value"
        )).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> SecurityConfig.validateRememberMeKey(environment, "too-short"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void prodAcceptsStrongRememberMeKey() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("prod");

        assertThatCode(() -> SecurityConfig.validateRememberMeKey(
                environment, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        )).doesNotThrowAnyException();
    }
}
