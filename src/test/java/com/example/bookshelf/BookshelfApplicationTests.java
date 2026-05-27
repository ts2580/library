package com.example.bookshelf;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;

@SpringBootTest
class BookshelfApplicationTests {

    @Test
    void contextLoads() {
    }

    @Test
    void datasourceUsesRootDataSqliteFileWithoutEnvironmentOverride() throws Exception {
        var resource = new ClassPathResource("application.yml");
        String applicationYaml = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);

        assertThat(applicationYaml).contains("url: jdbc:sqlite:./data/bookshelf.sqlite?foreign_keys=on&busy_timeout=5000");
        assertThat(applicationYaml).doesNotContain("BOOKSHELF_DB_URL");
    }
}
