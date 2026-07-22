package com.example.bookshelf.user.backup;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class BookshelfBackupRepository {

    private final JdbcTemplate jdbcTemplate;

    public BookshelfBackupRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<BackupBook> findBooksForOwner(int ownerId) {
        return jdbcTemplate.query("""
                SELECT id, name, author, type, totalvolume, description, cover, createddate
                FROM books
                WHERE owner_id = ?
                ORDER BY id
                """, (rs, rowNum) -> new BackupBook(
                Integer.toString(rs.getInt("id")),
                rs.getString("name"),
                rs.getString("author"),
                rs.getString("type"),
                rs.getString("totalvolume"),
                rs.getString("description"),
                rs.getString("cover"),
                rs.getString("createddate")
        ), ownerId);
    }

    public List<BackupVolume> findVolumesForOwner(int ownerId) {
        return jdbcTemplate.query("""
                SELECT bv.id, bv.book, bv.volume, bv.isbn13, bv.isbn, bv.name, bv.author, bv.type,
                       bv.price, bv.ispurchased, COALESCE(bv.noneedtobuy, 0) AS noneedtobuy,
                       bv.description, bv.cover, bv.originalUrl, bv.link, bv.pubdate, bv.createddate
                FROM book_volumes bv
                JOIN books b ON b.id = bv.book
                WHERE b.owner_id = ?
                ORDER BY bv.book, CASE WHEN bv.volume IS NULL THEN 1 ELSE 0 END, bv.volume, bv.id
                """, (rs, rowNum) -> new BackupVolume(
                Integer.toString(rs.getInt("book")),
                Integer.toString(rs.getInt("id")),
                nullableInteger(rs, "volume"),
                rs.getString("isbn13"),
                rs.getString("isbn"),
                rs.getString("name"),
                rs.getString("author"),
                rs.getString("type"),
                rs.getString("price"),
                rs.getBoolean("ispurchased"),
                rs.getBoolean("noneedtobuy"),
                rs.getString("description"),
                rs.getString("cover"),
                rs.getString("originalUrl"),
                rs.getString("link"),
                rs.getString("pubdate"),
                rs.getString("createddate")
        ), ownerId);
    }

    public List<String> findLocalCoverUrlsForOwner(int ownerId) {
        return jdbcTemplate.queryForList("""
                SELECT cover
                FROM books
                WHERE owner_id = ? AND cover LIKE '/covers/%'
                UNION
                SELECT bv.cover
                FROM book_volumes bv
                JOIN books b ON b.id = bv.book
                WHERE b.owner_id = ? AND bv.cover LIKE '/covers/%'
                ORDER BY cover
                """, String.class, ownerId, ownerId);
    }

    public void markLocalCoverAvailableForOwner(int ownerId, String coverUrl) {
        jdbcTemplate.update("""
                UPDATE books
                SET cover_generated = 1
                WHERE owner_id = ? AND cover = ?
                """, ownerId, coverUrl);
        jdbcTemplate.update("""
                UPDATE book_volumes
                SET cover_generated = 1
                WHERE cover = ?
                  AND book IN (SELECT id FROM books WHERE owner_id = ?)
                """, coverUrl, ownerId);
    }

    public List<Integer> findBookIdsForMerge(int ownerId, String name, String author) {
        return jdbcTemplate.queryForList("""
                SELECT id
                FROM books
                WHERE owner_id = ?
                  AND name = ?
                  AND (author = ? OR (author IS NULL AND ? IS NULL))
                ORDER BY id
                """, Integer.class, ownerId, name, author, author);
    }

    public Map<String, List<Integer>> findBookIdsByIsbn13ForOwner(int ownerId) {
        Map<String, List<Integer>> bookIdsByIsbn13 = new LinkedHashMap<>();
        jdbcTemplate.query("""
                SELECT bv.isbn13, b.id AS book_id
                FROM book_volumes bv
                JOIN books b ON b.id = bv.book
                WHERE b.owner_id = ?
                  AND bv.isbn13 IS NOT NULL
                  AND TRIM(bv.isbn13) <> ''
                ORDER BY bv.id
                """, resultSet -> {
            String isbn13 = resultSet.getString("isbn13").trim();
            int bookId = resultSet.getInt("book_id");
            List<Integer> bookIds = bookIdsByIsbn13.computeIfAbsent(isbn13, ignored -> new java.util.ArrayList<>());
            if (!bookIds.contains(bookId)) {
                bookIds.add(bookId);
            }
        }, ownerId);
        return bookIdsByIsbn13;
    }

    public int insertBook(int ownerId, BackupBook book) {
        saveCategory(book.type());
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            var statement = connection.prepareStatement("""
                    INSERT INTO books (owner_id, name, author, type, totalvolume, description, cover, createddate, cover_generated)
                    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP), 0)
                    """, Statement.RETURN_GENERATED_KEYS);
            statement.setInt(1, ownerId);
            statement.setString(2, book.name());
            statement.setString(3, book.author());
            statement.setString(4, book.type());
            statement.setString(5, book.totalVolume());
            statement.setString(6, book.description());
            statement.setString(7, book.cover());
            statement.setString(8, book.createdDate());
            return statement;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("백업 도서의 생성 ID를 확인할 수 없습니다.");
        }
        return key.intValue();
    }

    public void updateBook(int bookId, int ownerId, BackupBook book) {
        saveCategory(book.type());
        jdbcTemplate.update("""
                UPDATE books
                SET name = ?, author = ?, type = ?, totalvolume = ?, description = ?, cover = ?,
                    createddate = COALESCE(NULLIF(?, ''), createddate), cover_generated = 0
                WHERE id = ? AND owner_id = ?
                """, book.name(), book.author(), book.type(), book.totalVolume(), book.description(),
                book.cover(), book.createdDate(), bookId, ownerId);
    }

    public List<Integer> findVolumeIdsForMerge(int bookId, BackupVolume volume) {
        if (volume.isbn13() != null) {
            List<Integer> ids = jdbcTemplate.queryForList("""
                    SELECT id FROM book_volumes
                    WHERE book = ? AND isbn13 = ?
                    ORDER BY id
                    """, Integer.class, bookId, volume.isbn13());
            if (!ids.isEmpty()) {
                return ids;
            }
        }

        if (volume.sequence() == null) {
            return jdbcTemplate.queryForList("""
                    SELECT id FROM book_volumes
                    WHERE book = ? AND volume IS NULL
                      AND (name = ? OR (name IS NULL AND ? IS NULL))
                    ORDER BY id
                    """, Integer.class, bookId, volume.name(), volume.name());
        }
        return jdbcTemplate.queryForList("""
                SELECT id FROM book_volumes
                WHERE book = ? AND volume = ?
                  AND (name = ? OR (name IS NULL AND ? IS NULL))
                ORDER BY id
                """, Integer.class, bookId, volume.sequence(), volume.name(), volume.name());
    }

    public int insertVolume(int bookId, BackupVolume volume) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            var statement = connection.prepareStatement("""
                INSERT INTO book_volumes (
                    book, volume, seq, isbn13, isbn, name, author, type, price, ispurchased,
                    noneedtobuy, description, cover, originalUrl, link, pubdate, createddate, cover_generated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                          COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP), 0)
                """, Statement.RETURN_GENERATED_KEYS);
            statement.setInt(1, bookId);
            statement.setObject(2, volume.sequence());
            statement.setObject(3, volume.sequence());
            statement.setString(4, volume.isbn13());
            statement.setString(5, volume.isbn());
            statement.setString(6, volume.name());
            statement.setString(7, volume.author());
            statement.setString(8, volume.type());
            statement.setString(9, volume.price());
            statement.setBoolean(10, volume.purchased());
            statement.setBoolean(11, volume.noNeedToBuy());
            statement.setString(12, volume.description());
            statement.setString(13, volume.cover());
            statement.setString(14, volume.originalUrl());
            statement.setString(15, volume.link());
            statement.setString(16, volume.publicationDate());
            statement.setString(17, volume.createdDate());
            return statement;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("백업 권의 생성 ID를 확인할 수 없습니다.");
        }
        return key.intValue();
    }

    public void updateVolume(int volumeId, int bookId, BackupVolume volume) {
        jdbcTemplate.update("""
                UPDATE book_volumes
                SET volume = ?, seq = ?, isbn13 = ?, isbn = ?, name = ?, author = ?, type = ?,
                    price = ?, ispurchased = ?, noneedtobuy = ?, description = ?, cover = ?,
                    originalUrl = ?, link = ?, pubdate = ?,
                    createddate = COALESCE(NULLIF(?, ''), createddate), cover_generated = 0
                WHERE id = ? AND book = ?
                """, volume.sequence(), volume.sequence(), volume.isbn13(), volume.isbn(), volume.name(),
                volume.author(), volume.type(), volume.price(), volume.purchased(), volume.noNeedToBuy(),
                volume.description(), volume.cover(), volume.originalUrl(), volume.link(),
                volume.publicationDate(), volume.createdDate(), volumeId, bookId);
    }

    private void saveCategory(String category) {
        if (category != null) {
            jdbcTemplate.update("INSERT OR IGNORE INTO book_categories (name) VALUES (?)", category);
        }
    }

    private static Integer nullableInteger(ResultSet resultSet, String column) throws SQLException {
        int value = resultSet.getInt(column);
        return resultSet.wasNull() ? null : value;
    }

    public record BackupBook(
            String backupKey,
            String name,
            String author,
            String type,
            String totalVolume,
            String description,
            String cover,
            String createdDate
    ) {
    }

    public record BackupVolume(
            String bookBackupKey,
            String backupKey,
            Integer sequence,
            String isbn13,
            String isbn,
            String name,
            String author,
            String type,
            String price,
            boolean purchased,
            boolean noNeedToBuy,
            String description,
            String cover,
            String originalUrl,
            String link,
            String publicationDate,
            String createdDate
    ) {
    }
}
