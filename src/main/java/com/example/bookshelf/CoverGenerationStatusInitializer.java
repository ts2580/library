package com.example.bookshelf;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class CoverGenerationStatusInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(CoverGenerationStatusInitializer.class);
    private final JdbcTemplate jdbcTemplate;

    public CoverGenerationStatusInitializer(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(String... args) {
        addColumnIfMissing("books", "cover_generated");
        addColumnIfMissing("book_volumes", "cover_generated");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_books_cover_generated ON books (owner_id, cover_generated, id)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_book_volumes_cover_generated ON book_volumes (cover_generated, id)");
    }

    private void addColumnIfMissing(String table, String column) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pragma_table_info('" + table + "') WHERE name = ?",
                Integer.class,
                column
        );
        if (count != null && count > 0) {
            return;
        }
        log.info("Adding {}.{} for cover regeneration tracking", table, column);
        jdbcTemplate.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " INTEGER NOT NULL DEFAULT 0");
    }
}
