package com.example.bookshelf.user.repository;

import com.example.bookshelf.user.service.StockRefreshService.StockRefreshProgress;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;

@Repository
public class StockRefreshJobRepository {

    private final JdbcTemplate jdbcTemplate;

    public StockRefreshJobRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void initialize() {
        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS stock_refresh_job (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    running INTEGER NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0,
                    failed INTEGER NOT NULL DEFAULT 0,
                    total INTEGER NOT NULL DEFAULT 0,
                    processed INTEGER NOT NULL DEFAULT 0,
                    success INTEGER NOT NULL DEFAULT 0,
                    empty INTEGER NOT NULL DEFAULT 0,
                    fail INTEGER NOT NULL DEFAULT 0,
                    percent INTEGER NOT NULL DEFAULT 0,
                    message TEXT,
                    updated_at TEXT
                )
                """);
    }

    public StockRefreshProgress find() {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT running, completed, failed, total, processed, success, empty, fail, percent, message, updated_at FROM stock_refresh_job WHERE id = 1",
                    (rs, rowNum) -> new StockRefreshProgress(
                            rs.getBoolean("running"),
                            rs.getBoolean("completed"),
                            rs.getBoolean("failed"),
                            rs.getInt("total"),
                            rs.getInt("processed"),
                            rs.getInt("success"),
                            rs.getInt("empty"),
                            rs.getInt("fail"),
                            rs.getInt("percent"),
                            rs.getString("message"),
                            parseDateTime(rs.getString("updated_at"))
                    )
            );
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public void save(StockRefreshProgress progress) {
        jdbcTemplate.update("""
                INSERT INTO stock_refresh_job (id, running, completed, failed, total, processed, success, empty, fail, percent, message, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    running = excluded.running,
                    completed = excluded.completed,
                    failed = excluded.failed,
                    total = excluded.total,
                    processed = excluded.processed,
                    success = excluded.success,
                    empty = excluded.empty,
                    fail = excluded.fail,
                    percent = excluded.percent,
                    message = excluded.message,
                    updated_at = excluded.updated_at
                """,
                progress.running(), progress.completed(), progress.failed(), progress.total(), progress.processed(),
                progress.success(), progress.empty(), progress.fail(), progress.percent(), progress.message(),
                progress.updatedAt() == null ? null : progress.updatedAt().toString());
    }

    private LocalDateTime parseDateTime(String value) {
        return value == null || value.isBlank() ? null : LocalDateTime.parse(value);
    }
}
