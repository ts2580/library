package com.example.bookshelf.user.repository;

import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.BranchInventorySummary;
import com.example.bookshelf.user.model.BranchStockItem;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Repository
public class BranchInventoryRepository {

    private final JdbcTemplate jdbcTemplate;

    public BranchInventoryRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<BranchInventorySummary> findBranchInventorySummaries() {
        String sql = "SELECT branch, branch_name, stock_count, total_amount, priced_count, updated_at FROM branch_inventory_summary ORDER BY total_amount DESC, stock_count DESC, branch_name ASC";
        return jdbcTemplate.query(sql, (rs, rowNum) -> new BranchInventorySummary(
                rs.getString("branch"),
                rs.getString("branch_name"),
                rs.getInt("stock_count"),
                rs.getLong("total_amount"),
                rs.getInt("priced_count"),
                rs.getTimestamp("updated_at") == null ? null : rs.getTimestamp("updated_at").toLocalDateTime()
        ));
    }

    public int countBranchInventorySummaries() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM branch_inventory_summary", Integer.class);
        return count == null ? 0 : count;
    }

    public LocalDateTime findLatestBranchInventorySummaryUpdatedAt() {
        try {
            return jdbcTemplate.queryForObject("SELECT MAX(updated_at) FROM branch_inventory_summary", (rs, rowNum) -> rs.getTimestamp(1) == null ? null : rs.getTimestamp(1).toLocalDateTime());
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public void rebuildBranchInventorySummary() {
        jdbcTemplate.update("TRUNCATE TABLE branch_inventory_summary");
        String sql = """
                INSERT INTO branch_inventory_summary (branch, branch_name, stock_count, priced_count, total_amount, updated_at)
                SELECT
                    COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN') AS branch,
                    COALESCE(NULLIF(bb.branchname, ''), COALESCE(NULLIF(bb.branch, ''), '지점')) AS branch_name,
                    COUNT(*) AS stock_count,
                    SUM(CASE WHEN bb.price IS NOT NULL AND bb.price REGEXP '^[0-9,]+$' THEN 1 ELSE 0 END) AS priced_count,
                    SUM(CASE WHEN bb.price IS NOT NULL AND bb.price REGEXP '^[0-9,]+$' THEN CAST(REPLACE(bb.price, ',', '') AS UNSIGNED) ELSE 0 END) AS total_amount,
                    NOW() AS updated_at
                FROM branchbook bb
                GROUP BY COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN'), COALESCE(NULLIF(bb.branchname, ''), COALESCE(NULLIF(bb.branch, ''), '지점'))
                HAVING COUNT(*) > 0
                """;
        jdbcTemplate.update(sql);
    }

    public void deleteAllBranchInventoryData() {
        jdbcTemplate.update("DELETE FROM branch_inventory_summary");
        jdbcTemplate.update("DELETE FROM branchbook");
    }

    public List<BranchStockItem> findStocksByBranch(String branch) {
        String sql = """
                SELECT bb.id, bb.branch, bb.branchname, b.id AS bookId, bb.grade, b.name AS bookName, bb.name AS volumeName, bv.isbn13, bv.cover, bb.price, bb.booklink, bb.purchaseurl
                FROM branchbook bb
                LEFT JOIN books b ON b.id = bb.book
                LEFT JOIN book_volumes bv ON bv.book = bb.book AND bv.volume = bb.volume
                WHERE bb.branch = ?
                ORDER BY COALESCE(NULLIF(bb.grade, ''), 'ZZZ'), bv.name ASC
                """;
        return jdbcTemplate.query(sql, (rs, rowNum) -> new BranchStockItem(
                rs.getInt("id"),
                rs.getString("branch"),
                rs.getString("branchname"),
                rs.getInt("bookId"),
                rs.getString("grade"),
                rs.getString("bookName"),
                rs.getString("volumeName"),
                rs.getString("isbn13"),
                rs.getString("cover"),
                rs.getString("price"),
                rs.getString("booklink"),
                rs.getString("purchaseurl")
        ), branch);
    }

    public void deleteBranchBooksByBookAndVolume(int bookId, int volume) {
        jdbcTemplate.update("DELETE FROM branchbook WHERE book = ? AND volume = ?", bookId, volume);
    }

    public void insertBranchBooks(int bookId, String bookName, int volume, List<AladinBranchStock> stocks) {
        if (stocks == null || stocks.isEmpty()) return;
        String sql = """
                INSERT INTO branchbook (booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE price = VALUES(price), purchaseurl = VALUES(purchaseurl), name = VALUES(name), branchname = VALUES(branchname), grade = VALUES(grade), volume = VALUES(volume)
                """;
        jdbcTemplate.batchUpdate(sql, stocks, stocks.size(), (ps, stock) -> {
            String uuid = makeBranchBookUuid(bookId, stock.branch(), stock.branchName(), stock.grade(), stock.volume() > 0 ? stock.volume() : volume, stock.bookLink());
            ps.setString(1, normalize(stock.bookLink()));
            ps.setString(2, normalize(stock.purchaseLink()));
            ps.setString(3, normalize(stock.branch()));
            ps.setString(4, uuid);
            ps.setDouble(5, stock.volume() > 0 ? stock.volume() : volume);
            ps.setString(6, bookName);
            ps.setString(7, normalize(stock.price()));
            ps.setString(8, normalize(stock.branchName()));
            ps.setString(9, normalize(stock.grade()));
            ps.setInt(10, bookId);
        });
    }

    private String makeBranchBookUuid(int bookId, String branch, String branchName, String grade, double volume, String bookLink) {
        String raw = bookId + "|" + volume + "|" + safeNormalize(branch) + "|" + safeNormalize(branchName) + "|" + safeNormalize(grade) + "|" + safeNormalize(bookLink);
        return UUID.nameUUIDFromBytes(raw.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private String normalize(String value) {
        return (value == null || value.trim().isEmpty()) ? null : value.trim();
    }

    private String safeNormalize(String value) {
        String normalized = normalize(value);
        return normalized == null ? "" : normalized;
    }
}
