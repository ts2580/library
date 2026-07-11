package com.example.bookshelf.config;

import com.example.bookshelf.user.repository.MemberRepository;
import com.example.bookshelf.web.SessionKeys;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.authentication.rememberme.InMemoryTokenRepositoryImpl;
import org.springframework.security.web.authentication.rememberme.JdbcTokenRepositoryImpl;
import org.springframework.security.web.authentication.rememberme.PersistentTokenRepository;
import org.springframework.core.env.Environment;

import java.util.Arrays;

@Configuration
public class SecurityConfig {

    private static final String DEV_REMEMBER_ME_KEY = "bookshelf-dev-remember-me-change-me";
    private static final String COMPOSE_PLACEHOLDER_REMEMBER_ME_KEY = "change-this-long-random-value";

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   AuthenticationSuccessHandler authenticationSuccessHandler,
                                                   UserDetailsService userDetailsService,
                                                   PersistentTokenRepository persistentTokenRepository,
                                                   Environment environment,
                                                   @Value("${app.security.remember-me-key:" + DEV_REMEMBER_ME_KEY + "}")
                                                   String rememberMeKey) throws Exception {
        validateRememberMeKey(environment, rememberMeKey);
        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.POST,
                                "/api/migration/**",
                                "/dashboard/branches/delete-all",
                                "/dashboard/branches/refresh-stocks"
                        ).hasRole("ADMIN")
                        .requestMatchers("/dashboard/branches/**").hasRole("ADMIN")
                        .requestMatchers(
                                "/user/login", "/user/signup", "/error", "/css/**", "/js/**", "/images/**"
                        ).permitAll()
                        .anyRequest().authenticated()
                )
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(new org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint("/user/login"))
                        .accessDeniedHandler((request, response, accessDeniedException) -> {
                            org.springframework.security.core.Authentication auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
                            if (auth == null || !auth.isAuthenticated() || auth instanceof org.springframework.security.authentication.AnonymousAuthenticationToken) {
                                response.sendRedirect("/user/login");
                            } else {
                                response.sendError(HttpServletResponse.SC_FORBIDDEN, "Access Denied");
                            }
                        })
                )
                .formLogin(form -> form
                        .loginPage("/user/login")
                        .loginProcessingUrl("/user/login")
                        .successHandler(authenticationSuccessHandler)
                        .failureUrl("/user/login?error")
                        .permitAll()
                )
                .rememberMe(rememberMe -> rememberMe
                        .userDetailsService(userDetailsService)
                        .tokenRepository(persistentTokenRepository)
                        .key(rememberMeKey)
                        .rememberMeParameter("remember-me")
                        .alwaysRemember(false)
                        .tokenValiditySeconds(30 * 24 * 60 * 60)
                )
                .logout(logout -> logout
                        .logoutUrl("/user/logout")
                        .logoutSuccessUrl("/user/login?logout")
                        .invalidateHttpSession(true)
                        .clearAuthentication(true)
                );

        return http.build();
    }

    static void validateRememberMeKey(Environment environment, String rememberMeKey) {
        if (!Arrays.asList(environment.getActiveProfiles()).contains("prod")) {
            return;
        }
        if (rememberMeKey == null
                || rememberMeKey.isBlank()
                || rememberMeKey.length() < 32
                || DEV_REMEMBER_ME_KEY.equals(rememberMeKey)
                || COMPOSE_PLACEHOLDER_REMEMBER_ME_KEY.equals(rememberMeKey)) {
            throw new IllegalStateException(
                    "APP_REMEMBER_ME_KEY must be a non-default value of at least 32 characters when the prod profile is active."
            );
        }
    }

    @Bean
    public UserDetailsService userDetailsService(MemberRepository memberRepository) {
        return username -> {
            var member = memberRepository.findByUsername(username);
            if (member == null) {
                throw new UsernameNotFoundException("User not found: " + username);
            }

            User.UserBuilder builder = User.withUsername(member.username())
                    .password(member.passwordHash());
            UserDetails user = "trstyq".equalsIgnoreCase(member.username())
                    ? builder.roles("USER", "ADMIN").build()
                    : builder.roles("USER").build();
            return user;
        };
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new LegacyAwarePasswordEncoder();
    }

    @Bean
    public PersistentTokenRepository persistentTokenRepository(ObjectProvider<DataSource> dataSourceProvider) {
        DataSource dataSource = dataSourceProvider.getIfAvailable();
        if (dataSource == null) {
            return new InMemoryTokenRepositoryImpl();
        }
        JdbcTokenRepositoryImpl repository = new JdbcTokenRepositoryImpl();
        repository.setDataSource(dataSource);
        return repository;
    }

    @Bean
    public AuthenticationSuccessHandler authenticationSuccessHandler(MemberRepository memberRepository) {
        return (HttpServletRequest request,
                HttpServletResponse response,
                org.springframework.security.core.Authentication authentication) -> {
            var member = memberRepository.findByUsername(authentication.getName());
            HttpSession session = request.getSession(true);
            if (member != null) {
                session.setAttribute(SessionKeys.LOGIN_MEMBER_ID, member.id());
            }
            response.sendRedirect("/dashboard");
        };
    }

    private static class LegacyAwarePasswordEncoder implements PasswordEncoder {
        private static final Pattern SHA_256_HEX = Pattern.compile("^[0-9a-fA-F]{64}$");
        private static final String BCRYPT_PREFIX = "{bcrypt}";

        private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();

        @Override
        public String encode(CharSequence rawPassword) {
            return bcrypt.encode(rawPassword);
        }

        @Override
        public boolean matches(CharSequence rawPassword, String encodedPassword) {
            if (rawPassword == null || encodedPassword == null || encodedPassword.isBlank()) {
                return false;
            }
            if (isBcrypt(encodedPassword)) {
                return bcrypt.matches(rawPassword, normalizeBcrypt(encodedPassword));
            }
            if (SHA_256_HEX.matcher(encodedPassword).matches()) {
                return matchesLegacySha256(rawPassword, encodedPassword);
            }
            return false;
        }

        @Override
        public boolean upgradeEncoding(String encodedPassword) {
            return encodedPassword != null && !isBcrypt(encodedPassword);
        }

        private boolean isBcrypt(String encodedPassword) {
            return encodedPassword.startsWith("$2a$")
                    || encodedPassword.startsWith("$2b$")
                    || encodedPassword.startsWith("$2y$")
                    || encodedPassword.startsWith(BCRYPT_PREFIX);
        }

        private String normalizeBcrypt(String encodedPassword) {
            if (encodedPassword.startsWith(BCRYPT_PREFIX)) {
                return encodedPassword.substring(BCRYPT_PREFIX.length());
            }
            return encodedPassword;
        }

        private boolean matchesLegacySha256(CharSequence rawPassword, String encodedPassword) {
            String rawHash = sha256Hex(rawPassword.toString());
            return MessageDigest.isEqual(
                    rawHash.getBytes(StandardCharsets.UTF_8),
                    encodedPassword.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8)
            );
        }

        private String sha256Hex(String value) {
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
            } catch (NoSuchAlgorithmException e) {
                throw new IllegalStateException("SHA-256 is not available", e);
            }
        }
    }
}
