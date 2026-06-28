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
        assertThat(applicationYaml).contains("timeout: 30d");
        assertThat(applicationYaml).contains("max-age: 30d");
        assertThat(applicationYaml).doesNotContain("BOOKSHELF_DB_URL");

        var schema = new ClassPathResource("schema.sql");
        String schemaSql = StreamUtils.copyToString(schema.getInputStream(), StandardCharsets.UTF_8);
        assertThat(schemaSql).contains("CREATE TABLE IF NOT EXISTS persistent_logins");
        assertThat(schemaSql).contains("CREATE TABLE IF NOT EXISTS book_categories");
        assertThat(schemaSql).contains("INSERT OR IGNORE INTO book_categories");
    }
}
