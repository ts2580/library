package com.example.bookshelf.migration;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class NextMigrationConfiguration {
    @Bean
    FilterRegistrationBean<MigrationWriteFilter> migrationWriteFilter(MigrationWriteGate gate) {
        var registration = new FilterRegistrationBean<>(new MigrationWriteFilter(gate));
        registration.setOrder(-90); // After Spring Security authentication and CSRF.
        return registration;
    }
}
