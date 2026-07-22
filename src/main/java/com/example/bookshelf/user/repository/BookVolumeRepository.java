package com.example.bookshelf.user.repository;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.user.model.BookVolume;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.sql.Statement;

@Repository
public class BookVolumeRepository {

    private static final String BOOK_VOLUME_COLUMNS = "id, volume AS seq, book, isbn13, name, cover, price, description, ispurchased, COALESCE(noneedtobuy, FALSE) AS noneedtobuy, volume";
    private static final String SCOPED_BOOK_VOLUME_COLUMNS = "bv.id, bv.volume AS seq, bv.book, bv.isbn13, bv.name, bv.cover, bv.price, bv.description, bv.ispurchased, COALESCE(bv.noneedtobuy, FALSE) AS noneedtobuy, bv.volume";

    private final JdbcTemplate jdbcTemplate;

    public BookVolumeRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public int countAllBookVolumes() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes", Integer.class);
        return count == null ? 0 : count;
    }

    public int countAllBookVolumesForOwner(int ownerId) {
        return ownerColumnExists() ? count("SELECT COUNT(*) FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE b.owner_id = ?", ownerId) : 0;
    }

    public long sumPurchasedAmountForOwner(int ownerId) {
        return sumAmountForOwner(ownerId, true);
    }

    public long sumPlannedPurchaseAmountForOwner(int ownerId) {
        return sumAmountForOwner(ownerId, false);
    }

    public List<CategorySummary> findCategorySummariesForOwner(int ownerId) {
        if (!ownerColumnExists()) return List.of();
        String sql = """
                SELECT COALESCE(NULLIF(TRIM(b.type), ''), '미분류') AS category,
                       COUNT(*) AS volume_count,
                       COALESCE(SUM(CASE WHEN REPLACE(TRIM(COALESCE(bv.price, '')), ',', '') <> ''
                                             AND REPLACE(TRIM(COALESCE(bv.price, '')), ',', '') NOT GLOB '*[^0-9]*'
                                         THEN CAST(REPLACE(TRIM(bv.price), ',', '') AS INTEGER) ELSE 0 END), 0) AS total_amount
                FROM book_volumes bv
                JOIN books b ON b.id = bv.book
                WHERE b.owner_id = ?
                GROUP BY COALESCE(NULLIF(TRIM(b.type), ''), '미분류')
                ORDER BY volume_count DESC, total_amount DESC, category ASC
                """;
        return jdbcTemplate.query(sql, (rs, rowNum) -> new CategorySummary(
                rs.getString("category"), rs.getInt("volume_count"), rs.getLong("total_amount")
        ), ownerId);
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

    public int countVolumeSearchByKeywordForOwner(int ownerId, String keyword) {
        if (!ownerColumnExists()) return 0;
        String like = Texts.likePattern(keyword);
        return count("SELECT COUNT(*) FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE b.owner_id = ? AND (bv.name LIKE ? OR bv.isbn13 LIKE ?)", ownerId, like, like);
    }

    public List<BookVolume> searchVolumesByKeyword(String keyword, String sort, int limit, int offset) {
        String like = Texts.likePattern(keyword);
        String sql = "SELECT " + BOOK_VOLUME_COLUMNS + " FROM book_volumes WHERE name LIKE ? OR isbn13 LIKE ? " + orderBy(sort) + " LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, like, like, limit, offset);
    }

    public List<BookVolume> searchVolumesByKeywordForOwner(int ownerId, String keyword, String sort, int limit, int offset) {
        if (!ownerColumnExists()) return List.of();
        String like = Texts.likePattern(keyword);
        String sql = "SELECT " + SCOPED_BOOK_VOLUME_COLUMNS + " FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE b.owner_id = ? AND (bv.name LIKE ? OR bv.isbn13 LIKE ?) " + scopedOrderBy(sort) + " LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, ownerId, like, like, limit, offset);
    }

    public List<BookVolume> findAllVolumes(String sort, int limit, int offset) {
        String sql = "SELECT " + BOOK_VOLUME_COLUMNS + " FROM book_volumes " + orderBy(sort) + " LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, limit, offset);
    }

    public List<BookVolume> findAllVolumesForOwner(int ownerId, String sort, int limit, int offset) {
        if (!ownerColumnExists()) return List.of();
        String sql = "SELECT " + SCOPED_BOOK_VOLUME_COLUMNS + " FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE b.owner_id = ? " + scopedOrderBy(sort) + " LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, ownerId, limit, offset);
    }

    public List<BookVolume> findVolumesPendingCoverGenerationForOwner(int ownerId) {
        if (!ownerColumnExists()) return List.of();
        String sql = "SELECT " + SCOPED_BOOK_VOLUME_COLUMNS
                + " FROM book_volumes bv JOIN books b ON b.id = bv.book"
                + " WHERE b.owner_id = ? AND COALESCE(bv.cover_generated, 0) = 0"
                + " AND TRIM(COALESCE(bv.isbn13, '')) <> '' ORDER BY bv.id";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, ownerId);
    }

    public int countUnpurchasedVolumes() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE ispurchased = FALSE AND COALESCE(noneedtobuy, FALSE) = FALSE", Integer.class);
        return count == null ? 0 : count;
    }

    public List<BookVolume> findUnpurchasedVolumesAfterId(int lastSeenId, int limit) {
        String sql = """
                SELECT id, volume AS seq, book, isbn13, name, cover, price, description, ispurchased, COALESCE(noneedtobuy, FALSE) AS noneedtobuy, volume
                FROM book_volumes
                WHERE ispurchased = FALSE AND COALESCE(noneedtobuy, FALSE) = FALSE AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, lastSeenId, limit);
    }

    public List<BookVolume> findVolumesByBookId(int bookId) {
        String sql = """
                SELECT id, volume AS seq, book, isbn13, name, cover, price, description, ispurchased, COALESCE(noneedtobuy, FALSE) AS noneedtobuy, volume
                FROM book_volumes
                WHERE book = ?
                ORDER BY CASE WHEN volume IS NULL THEN 1 ELSE 0 END, volume ASC, id ASC
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, bookId);
    }

    public boolean existsVolumeByIsbn13(String isbn13) {
        Integer cnt = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE isbn13 = ?", Integer.class, Texts.trimToEmpty(isbn13));
        return cnt != null && cnt > 0;
    }

    public boolean existsVolumeByIsbn13ForOwner(int ownerId, String isbn13) {
        if (!ownerColumnExists()) return false;
        return count("SELECT COUNT(*) FROM book_volumes bv JOIN books b ON b.id = bv.book WHERE b.owner_id = ? AND bv.isbn13 = ?", ownerId, Texts.trimToEmpty(isbn13)) > 0;
    }

    public int nextVolumeSeq(int bookId) {
        Integer seq = jdbcTemplate.queryForObject("SELECT COUNT(*) + 1 FROM book_volumes WHERE book = ?", Integer.class, bookId);
        return seq == null ? 1 : seq;
    }

    public int insertVolume(int bookId, Integer seq, String isbn13, String name, String cover, String price, String description) {
        String sql = """
                INSERT INTO book_volumes (book, isbn13, name, cover, price, description, ispurchased, volume, createddate, cover_generated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                """;
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            var ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            ps.setInt(1, bookId);
            ps.setString(2, Texts.trimToNull(isbn13));
            ps.setString(3, Texts.trimToNull(name));
            ps.setString(4, Texts.trimToNull(cover));
            ps.setString(5, Texts.trimToNull(price));
            ps.setString(6, Texts.trimToNull(description));
            ps.setBoolean(7, false);
            ps.setObject(8, seq);
            ps.setBoolean(9, isGeneratedCover(cover));
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) throw new IllegalStateException("Failed to get generated book volume id.");
        return key.intValue();
    }

    public void updateVolume(int bookId, int volumeId, String isbn13, String name, String cover, String price, String description, boolean purchased, boolean noNeedToBuy, Integer seq) {
        String sql = """
                UPDATE book_volumes
                SET isbn13 = ?, name = ?, cover = ?, price = ?, description = ?, ispurchased = ?, noneedtobuy = ?, volume = ?, cover_generated = ?
                WHERE id = ? AND book = ?
                """;
        jdbcTemplate.update(sql, Texts.trimToNull(isbn13), Texts.trimToNull(name), Texts.trimToNull(cover), Texts.trimToNull(price), Texts.trimToNull(description), purchased, noNeedToBuy, seq, isGeneratedCover(cover), volumeId, bookId);
    }

    public void updateGeneratedCoverForOwner(int bookId, int volumeId, int ownerId, String cover) {
        jdbcTemplate.update("""
                UPDATE book_volumes
                SET cover = ?, cover_generated = ?
                WHERE id = ? AND book = ?
                  AND EXISTS (SELECT 1 FROM books b WHERE b.id = book_volumes.book AND b.owner_id = ?)
                """, Texts.trimToNull(cover), isGeneratedCover(cover), volumeId, bookId, ownerId);
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

    public int countByCover(String cover) {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE cover = ?", Integer.class, Texts.trimToNull(cover));
        return count == null ? 0 : count;
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
                      AND (? = TRUE OR COALESCE(noneedtobuy, FALSE) = FALSE)
                )
                """;
        Long total = jdbcTemplate.queryForObject(sql, Long.class, purchased, purchased);
        return total == null ? 0L : total;
    }

    private long sumAmountForOwner(int ownerId, boolean purchased) {
        if (!ownerColumnExists()) return 0L;
        String sql = """
                SELECT COALESCE(SUM(
                    CASE
                        WHEN REPLACE(TRIM(COALESCE(bv.price, '')), ',', '') <> ''
                         AND REPLACE(TRIM(COALESCE(bv.price, '')), ',', '') NOT GLOB '*[^0-9]*'
                        THEN CAST(REPLACE(TRIM(bv.price), ',', '') AS INTEGER)
                        ELSE 0
                    END
                ), 0)
                FROM book_volumes bv
                JOIN books b ON b.id = bv.book
                WHERE b.owner_id = ?
                  AND bv.ispurchased = ?
                  AND (? = TRUE OR COALESCE(bv.noneedtobuy, FALSE) = FALSE)
                """;
        Long total = jdbcTemplate.queryForObject(sql, Long.class, ownerId, purchased, purchased);
        return total == null ? 0L : total;
    }

    private String scopedOrderBy(String sort) {
        return "recent".equalsIgnoreCase(sort)
                ? "ORDER BY bv.createddate DESC, bv.id DESC"
                : "ORDER BY bv.id DESC";
    }

    private int count(String sql, Object... args) {
        Integer result = jdbcTemplate.queryForObject(sql, Integer.class, args);
        return result == null ? 0 : result;
    }

    private boolean ownerColumnExists() {
        return count("SELECT COUNT(*) FROM pragma_table_info('books') WHERE name = 'owner_id'") > 0;
    }

    private static boolean isGeneratedCover(String cover) {
        String normalized = Texts.trimToNull(cover);
        return normalized != null && normalized.startsWith("/covers/");
    }

    public record CategorySummary(String category, int volumeCount, long totalAmount) {}
}
