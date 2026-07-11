package com.example.bookshelf.user.repository;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.BranchInventorySummary;
import com.example.bookshelf.user.model.BranchStockItem;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

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
                displayBranchName(rs.getString("branch"), rs.getString("branch_name")),
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

    @Transactional
    public void rebuildBranchInventorySummary() {
        jdbcTemplate.update("DELETE FROM branch_inventory_summary");
        String sql = """
                INSERT INTO branch_inventory_summary (branch, branch_name, stock_count, priced_count, total_amount, updated_at)
                SELECT
                    COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN') AS branch,
                    COALESCE(
                        CASE
                            WHEN LOWER(TRIM(bb.branchname)) IN ('', 'branchname') THEN NULL
                            ELSE NULLIF(TRIM(bb.branchname), '')
                        END,
                        COALESCE(NULLIF(bb.branch, ''), '지점')
                    ) AS branch_name,
                    COUNT(*) AS stock_count,
                    SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END) AS priced_count,
                    SUM(CASE WHEN REPLACE(COALESCE(bb.price, ''), ',', '') <> '' AND REPLACE(bb.price, ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bb.price, ',', '') AS INTEGER) ELSE 0 END) AS total_amount,
                    CURRENT_TIMESTAMP AS updated_at
                FROM branchbook bb
                GROUP BY
                    COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN'),
                    COALESCE(
                        CASE
                            WHEN LOWER(TRIM(bb.branchname)) IN ('', 'branchname') THEN NULL
                            ELSE NULLIF(TRIM(bb.branchname), '')
                        END,
                        COALESCE(NULLIF(bb.branch, ''), '지점')
                    )
                HAVING COUNT(*) > 0
                """;
        jdbcTemplate.update(sql);
    }

    @Transactional
    public void deleteAllBranchInventoryData() {
        jdbcTemplate.update("DELETE FROM branch_inventory_summary");
        jdbcTemplate.update("DELETE FROM branchbook");
    }

    public List<BranchStockItem> findStocksByBranch(String branch) {
        String sql = """
                SELECT
                    bb.id,
                    bb.branch,
                    CASE
                        WHEN LOWER(TRIM(COALESCE(bb.branchname, ''))) IN ('', 'branchname') THEN NULL
                        ELSE NULLIF(TRIM(bb.branchname), '')
                    END AS branchname,
                    b.id AS bookId,
                    bb.grade,
                    b.name AS bookName,
                    bb.name AS volumeName,
                    bv.isbn13,
                    bv.cover,
                    bb.price,
                    bb.booklink,
                    bb.purchaseurl
                FROM branchbook bb
                LEFT JOIN books b ON b.id = bb.book
                LEFT JOIN book_volumes bv ON %s
                WHERE bb.branch = ?
                ORDER BY COALESCE(NULLIF(bb.grade, ''), 'ZZZ'), bv.name ASC
                """.formatted(branchBookVolumeReferenceColumnExists()
                        ? "bv.id = bb.book_volume_id"
                        : "bv.book = bb.book AND bv.volume = bb.volume");
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

    public String findBranchDisplayName(String branch) {
        String normalizedBranch = Texts.trimToNull(branch);
        if (normalizedBranch == null) {
            return null;
        }

        try {
            return jdbcTemplate.queryForObject(
                    """
                    SELECT branch_name
                    FROM branch_inventory_summary
                    WHERE branch = ?
                      AND TRIM(COALESCE(branch_name, '')) <> ''
                      AND LOWER(TRIM(branch_name)) <> 'branchname'
                    LIMIT 1
                    """,
                    String.class,
                    normalizedBranch
            );
        } catch (EmptyResultDataAccessException e) {
            // continue
        }

        try {
            return jdbcTemplate.queryForObject(
                    "SELECT branchname FROM branchbook WHERE (branch = ? OR branchname = ?) AND TRIM(COALESCE(branchname, '')) <> '' AND LOWER(TRIM(branchname)) <> 'branchname' LIMIT 1",
                    String.class,
                    normalizedBranch, normalizedBranch
            );
        } catch (EmptyResultDataAccessException e) {
            // no branch name
        }

        return null;
    }

    private String displayBranchName(String branch, String branchName) {
        String normalizedBranchName = Texts.trimToNull(branchName);
        if (isDisplayableBranchName(normalizedBranchName)) {
            return normalizedBranchName;
        }

        String normalizedBranch = Texts.trimToNull(branch);
        if (isDisplayableBranchName(normalizedBranch)) {
            return normalizedBranch;
        }

        return "지점";
    }

    private boolean isDisplayableBranchName(String value) {
        return value != null && !value.isBlank() && !"branchname".equalsIgnoreCase(value.trim());
    }

    public void deleteBranchBooksByBookAndVolume(int bookId, int volume) {
        jdbcTemplate.update("DELETE FROM branchbook WHERE book = ? AND volume = ?", bookId, volume);
    }

    public void deleteBranchBooksByBookVolumeId(int bookVolumeId, int bookId, int volume) {
        if (branchBookVolumeReferenceColumnExists()) {
            jdbcTemplate.update("DELETE FROM branchbook WHERE book_volume_id = ?", bookVolumeId);
        } else {
            deleteBranchBooksByBookAndVolume(bookId, volume);
        }
    }

    @Transactional
    public void replaceBranchBooks(int bookId, String bookName, int volume, List<AladinBranchStock> stocks) {
        deleteBranchBooksByBookAndVolume(bookId, volume);
        insertBranchBooks(bookId, bookName, volume, stocks);
    }

    @Transactional
    public void replaceBranchBooks(int bookVolumeId, int bookId, String bookName, int volume, List<AladinBranchStock> stocks) {
        deleteBranchBooksByBookVolumeId(bookVolumeId, bookId, volume);
        insertBranchBooks(bookVolumeId, bookId, bookName, volume, stocks);
    }

    public void insertBranchBooks(int bookId, String bookName, int volume, List<AladinBranchStock> stocks) {
        insertBranchBooks(null, bookId, bookName, volume, stocks);
    }

    public void insertBranchBooks(Integer bookVolumeId, int bookId, String bookName, int volume, List<AladinBranchStock> stocks) {
        if (stocks == null || stocks.isEmpty()) return;
        boolean stableReference = bookVolumeId != null && branchBookVolumeReferenceColumnExists();
        String sql = (stableReference ? """
                INSERT INTO branchbook (booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book, book_volume_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """ : """
                INSERT INTO branchbook (booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """) + """
                ON CONFLICT(uuid) DO UPDATE SET
                    price = excluded.price,
                    purchaseurl = excluded.purchaseurl,
                    name = excluded.name,
                    branchname = excluded.branchname,
                    grade = excluded.grade,
                    volume = excluded.volume
                """;
        jdbcTemplate.batchUpdate(sql, stocks, stocks.size(), (ps, stock) -> {
            String uuid = makeBranchBookUuid(bookVolumeId, bookId, stock.branch(), stock.branchName(), stock.grade(), stock.volume() > 0 ? stock.volume() : volume, stock.bookLink());
            ps.setString(1, Texts.trimToNull(stock.bookLink()));
            ps.setString(2, Texts.trimToNull(stock.purchaseLink()));
            ps.setString(3, Texts.trimToNull(stock.branch()));
            ps.setString(4, uuid);
            ps.setDouble(5, stock.volume() > 0 ? stock.volume() : volume);
            ps.setString(6, bookName);
            ps.setString(7, Texts.trimToNull(stock.price()));
            ps.setString(8, Texts.trimToNull(stock.branchName()));
            ps.setString(9, Texts.trimToNull(stock.grade()));
            ps.setInt(10, bookId);
            if (stableReference) ps.setInt(11, bookVolumeId);
        });
    }

    private String makeBranchBookUuid(Integer bookVolumeId, int bookId, String branch, String branchName, String grade, double volume, String bookLink) {
        String raw = (bookVolumeId == null ? bookId + "|" + volume : "volumeId:" + bookVolumeId)
                + "|" + safeNormalize(branch) + "|" + safeNormalize(branchName) + "|" + safeNormalize(grade) + "|" + safeNormalize(bookLink);
        return UUID.nameUUIDFromBytes(raw.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private boolean branchBookVolumeReferenceColumnExists() {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pragma_table_info('branchbook') WHERE name = 'book_volume_id'",
                Integer.class
        );
        return count != null && count > 0;
    }

    private String safeNormalize(String value) {
        return Texts.trimToEmpty(value);
    }
}
