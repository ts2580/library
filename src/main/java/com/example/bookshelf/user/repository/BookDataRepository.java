package com.example.bookshelf.user.repository;

import com.example.bookshelf.user.model.Book;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.Statement;
import java.util.List;

@Repository
public class BookDataRepository {

    private static final int DEFAULT_PAGE_SIZE = 20;

    private final JdbcTemplate jdbcTemplate;

    public BookDataRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Book> searchBooksByKeywordOrderByVolumeDesc(String keyword, int limit, int offset) {
        String ftq = toBooleanFullTextQuery(keyword);
        String sql = """
                SELECT b.id, b.name, b.author, b.description, b.totalvolume, b.type, b.cover, NULL AS `sync`, b.createddate
                FROM books b
                LEFT JOIN (
                    SELECT book, COUNT(*) AS volume_count
                    FROM book_volumes
                    WHERE book IS NOT NULL
                    GROUP BY book
                ) v ON v.book = b.id
                WHERE MATCH(b.name, b.author) AGAINST (? IN BOOLEAN MODE)
                ORDER BY COALESCE(v.volume_count, 0) DESC, b.id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, ftq, limit, offset);
    }

    public List<Book> searchBooksByKeywordFallback(String keyword, int limit, int offset) {
        String like = '%' + normalizeForLike(keyword) + '%';
        String sql = """
                SELECT b.id, b.name, b.author, b.description, b.totalvolume, b.type, b.cover, NULL AS `sync`, b.createddate
                FROM books b
                WHERE b.name LIKE ? OR b.author LIKE ?
                ORDER BY b.id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, like, like, limit, offset);
    }


    public int countSearchBooksByKeyword(String keyword) {
        String ftq = toBooleanFullTextQuery(keyword);
        String sql = "SELECT COUNT(*) FROM books WHERE MATCH(name, author) AGAINST (? IN BOOLEAN MODE)";
        Integer cnt = jdbcTemplate.queryForObject(sql, Integer.class, ftq);
        return cnt == null ? 0 : cnt;
    }

    public List<String> findAllBookTypes() {
        String sql = "SELECT DISTINCT type FROM books WHERE type IS NOT NULL AND TRIM(type) <> '' ORDER BY type ASC";
        return jdbcTemplate.queryForList(sql, String.class);
    }

    public int countBooksByType(String type) {
        String sql = "SELECT COUNT(*) FROM books WHERE type = ?";
        Integer cnt = jdbcTemplate.queryForObject(sql, Integer.class, type);
        return cnt == null ? 0 : cnt;
    }

    public int countSearchBooksByKeywordAndType(String keyword, String type) {
        String ftq = toBooleanFullTextQuery(keyword);
        String sql = "SELECT COUNT(*) FROM books WHERE MATCH(name, author) AGAINST (? IN BOOLEAN MODE) AND type = ?";
        Integer cnt = jdbcTemplate.queryForObject(sql, Integer.class, ftq, type);
        return cnt == null ? 0 : cnt;
    }

    public List<Book> searchBooksByKeywordAndType(String keyword, String type, int limit, int offset) {
        String ftq = toBooleanFullTextQuery(keyword);
        String sql = """
                SELECT b.id, b.name, b.author, b.description, b.totalvolume, b.type, b.cover, NULL AS `sync`, b.createddate
                FROM books b
                LEFT JOIN (
                    SELECT book, COUNT(*) AS volume_count
                    FROM book_volumes
                    WHERE book IS NOT NULL
                    GROUP BY book
                ) v ON v.book = b.id
                WHERE MATCH(b.name, b.author) AGAINST (? IN BOOLEAN MODE) AND b.type = ?
                ORDER BY COALESCE(v.volume_count, 0) DESC, b.id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, ftq, type, limit, offset);
    }

    public List<Book> findAllBooksByTypeAndCreatedDesc(String type, int limit, int offset) {
        String sql = """
                SELECT b.id, b.name, b.author, b.description, b.totalvolume, b.type, b.cover, NULL AS `sync`, COALESCE(v.lastVolumeId, b.id) AS createddate
                FROM books b
                LEFT JOIN (
                    SELECT book, MAX(id) AS lastVolumeId
                    FROM book_volumes
                    GROUP BY book
                ) v ON v.book = b.id
                WHERE b.type = ?
                ORDER BY COALESCE(v.lastVolumeId, b.id) DESC, b.id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, type, limit, offset);
    }

    public List<Book> findAllBooksOrderByCreatedDesc(int limit, int offset) {
        String sql = """
                SELECT b.id, b.name, b.author, b.description, b.totalvolume, b.type, b.cover, NULL AS `sync`, COALESCE(v.lastVolumeId, b.id) AS createddate
                FROM books b
                LEFT JOIN (
                    SELECT book, MAX(id) AS lastVolumeId
                    FROM book_volumes
                    GROUP BY book
                ) v ON v.book = b.id
                ORDER BY COALESCE(v.lastVolumeId, b.id) DESC, b.id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, limit, offset);
    }

    public int countAllBooks() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books", Integer.class);
        return count == null ? 0 : count;
    }

    public List<Book> findAllBooks() {
        String sql = "SELECT id, name, author, description, totalvolume, type, cover, NULL AS `sync`, createddate FROM books ORDER BY id DESC";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK);
    }

    public Book findBookById(int id) {
        String sql = "SELECT id, name, author, description, totalvolume, type, cover, NULL AS `sync`, createddate FROM books WHERE id = ?";
        try {
            return jdbcTemplate.queryForObject(sql, BookRowMappers.BOOK, id);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public Integer findBookIdByNameAndAuthor(String name, String author) {
        String sql = "SELECT id FROM books WHERE name = ? AND author = ? LIMIT 1";
        try {
            return jdbcTemplate.queryForObject(sql, Integer.class, name, author);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public int insertBook(String name, String author, String description, String cover, String type, String totalVolume) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        String sql = "INSERT INTO books (name, author, description, type, cover, totalvolume) VALUES (?, ?, ?, ?, ?, ?)";
        jdbcTemplate.update(connection -> {
            var ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, name);
            ps.setString(2, author);
            ps.setString(3, description);
            ps.setString(4, type);
            ps.setString(5, cover);
            ps.setString(6, totalVolume);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) throw new IllegalStateException("Failed to get generated book id.");
        return key.intValue();
    }

    public void updateBook(int bookId, String name, String author, String description, String cover, String type, String totalVolume) {
        String sql = """
                UPDATE books
                SET name = ?, author = ?, description = ?, cover = ?, type = ?, totalvolume = ?
                WHERE id = ?
                """;
        jdbcTemplate.update(sql, normalize(name), normalize(author), normalize(description), normalize(cover), normalize(type), normalize(totalVolume), bookId);
    }

    public void deleteBookById(int bookId) {
        jdbcTemplate.update("DELETE FROM books WHERE id = ?", bookId);
    }

    public int defaultPageSize() {
        return DEFAULT_PAGE_SIZE;
    }

    private String toBooleanFullTextQuery(String keyword) {
        if (keyword == null) return "";
        String trimmed = keyword.trim();
        if (trimmed.isEmpty()) return "";
        String[] tokens = trimmed.split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String token : tokens) {
            if (token == null || token.isBlank()) continue;
            String cleaned = token.replaceAll("[^\\p{L}\\p{N}가-힣]", "");
            if (cleaned.isBlank()) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append('+').append(cleaned);
            if (cleaned.length() >= 2) sb.append('*');
        }
        return sb.length() > 0 ? sb.toString() : cleanedFallback(trimmed);
    }

    private String cleanedFallback(String keyword) {
        String fallback = keyword.replace("%", "").replace("'", "");
        return fallback + "*";
    }

    private String normalizeForLike(String value) {
        return value == null ? "" : value.replace("%", "").replace("_", "").trim();
    }

    private String normalize(String value) {
        return (value == null || value.trim().isEmpty()) ? null : value.trim();
    }
}
