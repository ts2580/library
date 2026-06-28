package com.example.bookshelf.user.repository;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.user.model.BookVolume;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Repository
public class BookVolumeRepository {

    private static final String BOOK_VOLUME_COLUMNS = "id, volume AS seq, book, isbn13, name, cover, price, ispurchased, volume";

    private final JdbcTemplate jdbcTemplate;

    public BookVolumeRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public int countAllBookVolumes() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes", Integer.class);
        return count == null ? 0 : count;
    }

    public long sumPurchasedAmount() {
        return sumAmountByPurchased(true);
    }

    public long sumPlannedPurchaseAmount() {
        return sumAmountByPurchased(false);
    }

    public List<CategorySummary> findCategorySummaries() {
        String sql = """
                SELECT category,
                       COUNT(*) AS volume_count,
                       COALESCE(SUM(
                           CASE
                               WHEN normalized_price <> '' AND normalized_price NOT GLOB '*[^0-9]*'
                               THEN CAST(normalized_price AS INTEGER)
                               ELSE 0
                           END
                       ), 0) AS total_amount
                FROM (
                    SELECT COALESCE(NULLIF(TRIM(b.type), ''), '미분류') AS category,
                           REPLACE(TRIM(COALESCE(bv.price, '')), ',', '') AS normalized_price
                    FROM book_volumes bv
                    LEFT JOIN books b ON b.id = bv.book
                )
                GROUP BY category
                ORDER BY volume_count DESC, total_amount DESC, category ASC
                """;
        return jdbcTemplate.query(sql, (rs, rowNum) -> new CategorySummary(
                rs.getString("category"),
                rs.getInt("volume_count"),
                rs.getLong("total_amount")
        ));
    }

    public int countVolumeSearchByKeyword(String keyword) {
        String like = Texts.likePattern(keyword);
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE name LIKE ? OR isbn13 LIKE ?", Integer.class, like, like);
        return count == null ? 0 : count;
    }

    public List<BookVolume> searchVolumesByKeyword(String keyword, String sort, int limit, int offset) {
        String like = Texts.likePattern(keyword);
        String sql = "SELECT " + BOOK_VOLUME_COLUMNS + " FROM book_volumes WHERE name LIKE ? OR isbn13 LIKE ? " + orderBy(sort) + " LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, like, like, limit, offset);
    }

    public List<BookVolume> findAllVolumes(String sort, int limit, int offset) {
        String sql = "SELECT " + BOOK_VOLUME_COLUMNS + " FROM book_volumes " + orderBy(sort) + " LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, limit, offset);
    }

    public int countUnpurchasedVolumes() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE ispurchased = FALSE", Integer.class);
        return count == null ? 0 : count;
    }

    public List<BookVolume> findUnpurchasedVolumesAfterId(int lastSeenId, int limit) {
        String sql = """
                SELECT id, volume AS seq, book, isbn13, name, cover, price, ispurchased, volume
                FROM book_volumes
                WHERE ispurchased = FALSE AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, lastSeenId, limit);
    }

    public List<BookVolume> findVolumesByBookId(int bookId) {
        String sql = """
                SELECT id, volume AS seq, book, isbn13, name, cover, price, ispurchased, volume
                FROM book_volumes
                WHERE book = ?
                ORDER BY volume ASC, id ASC
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, bookId);
    }

    public boolean existsVolumeByIsbn13(String isbn13) {
        Integer cnt = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE isbn13 = ?", Integer.class, Texts.trimToEmpty(isbn13));
        return cnt != null && cnt > 0;
    }

    public int nextVolumeSeq(int bookId) {
        Integer seq = jdbcTemplate.queryForObject("SELECT COALESCE(MAX(volume), 0) + 1 FROM book_volumes WHERE book = ?", Integer.class, bookId);
        return seq == null ? 1 : seq;
    }

    public void insertVolume(int bookId, int seq, String isbn13, String name, String cover, String price) {
        String sql = """
                INSERT INTO book_volumes (book, isbn13, name, cover, price, ispurchased, volume, createddate)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """;
        jdbcTemplate.update(sql, bookId, Texts.trimToNull(isbn13), Texts.trimToNull(name), Texts.trimToNull(cover), Texts.trimToNull(price), false, seq);
    }

    public void updateVolume(int bookId, int volumeId, String isbn13, String name, String cover, String price, boolean purchased, Integer seq) {
        String sql = """
                UPDATE book_volumes
                SET isbn13 = ?, name = ?, cover = ?, price = ?, ispurchased = ?, volume = ?
                WHERE id = ? AND book = ?
                """;
        jdbcTemplate.update(sql, Texts.trimToNull(isbn13), Texts.trimToNull(name), Texts.trimToNull(cover), Texts.trimToNull(price), purchased, seq, volumeId, bookId);
    }

    public void deleteVolumesByBookId(int bookId) {
        jdbcTemplate.update("DELETE FROM book_volumes WHERE book = ?", bookId);
    }

    public void deleteVolumesByBookAndIds(int bookId, List<Integer> volumeIds) {
        if (volumeIds == null || volumeIds.isEmpty()) return;
        String placeholders = String.join(",", Collections.nCopies(volumeIds.size(), "?"));
        List<Object> params = new ArrayList<>();
        params.add(bookId);
        params.addAll(volumeIds);
        String sql = String.format("DELETE FROM book_volumes WHERE book = ? AND id IN (%s)", placeholders);
        jdbcTemplate.update(sql, params.toArray());
    }

    private String orderBy(String sort) {
        return "recent".equalsIgnoreCase(sort)
                ? "ORDER BY createddate DESC, id DESC"
                : "ORDER BY id DESC";
    }

    private long sumAmountByPurchased(boolean purchased) {
        String sql = """
                SELECT COALESCE(SUM(
                    CASE
                        WHEN normalized_price <> '' AND normalized_price NOT GLOB '*[^0-9]*'
                        THEN CAST(normalized_price AS INTEGER)
                        ELSE 0
                    END
                ), 0)
                FROM (
                    SELECT REPLACE(TRIM(COALESCE(price, '')), ',', '') AS normalized_price
                    FROM book_volumes
                    WHERE ispurchased = ?
                )
                """;
        Long total = jdbcTemplate.queryForObject(sql, Long.class, purchased);
        return total == null ? 0L : total;
    }

    public record CategorySummary(String category, int volumeCount, long totalAmount) {}
}
