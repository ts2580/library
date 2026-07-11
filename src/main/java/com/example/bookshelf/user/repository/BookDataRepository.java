package com.example.bookshelf.user.repository;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.user.model.Book;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

@Repository
public class BookDataRepository {

    private static final String BOOK_COLUMNS = "b.id, b.name, b.author, b.description, CAST(COALESCE(vc.volume_count, 0) AS TEXT) AS totalvolume, b.type, b.cover, NULL AS sync, b.createddate";
    private static final String BOOK_TABLE_COLUMNS = "id, name, author, description, totalvolume, type, cover, NULL AS sync, createddate";
    private static final String VOLUME_COUNT_JOIN = """
            LEFT JOIN (
                SELECT book, COUNT(*) AS volume_count
                FROM book_volumes
                WHERE book IS NOT NULL
                GROUP BY book
            ) vc ON vc.book = b.id
            """;
    private static final String LAST_VOLUME_JOIN = """
            LEFT JOIN (
                SELECT book, MAX(id) AS lastVolumeId
                FROM book_volumes
                GROUP BY book
            ) lv ON lv.book = b.id
            """;

    private final JdbcTemplate jdbcTemplate;

    public BookDataRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Book> searchBooksByKeywordOrderByVolumeDesc(String keyword, int limit, int offset) {
        String like = Texts.likePattern(keyword);
        String sql = "SELECT " + BOOK_COLUMNS + " FROM books b " + VOLUME_COUNT_JOIN + " WHERE b.name LIKE ? OR b.author LIKE ? ORDER BY COALESCE(vc.volume_count, 0) DESC, b.id DESC LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, like, like, limit, offset);
    }

    public List<Book> searchBooksByKeywordFallback(String keyword, int limit, int offset) {
        String like = Texts.likePattern(keyword);
        String sql = "SELECT " + BOOK_COLUMNS + " FROM books b " + VOLUME_COUNT_JOIN + " WHERE b.name LIKE ? OR b.author LIKE ? ORDER BY b.id DESC LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, like, like, limit, offset);
    }

    public int countSearchBooksByKeyword(String keyword) {
        String like = Texts.likePattern(keyword);
        String sql = "SELECT COUNT(*) FROM books WHERE name LIKE ? OR author LIKE ?";
        Integer cnt = jdbcTemplate.queryForObject(sql, Integer.class, like, like);
        return cnt == null ? 0 : cnt;
    }

    public List<String> findAllBookTypes() {
        String sql = "SELECT name FROM book_categories ORDER BY name ASC";
        return jdbcTemplate.queryForList(sql, String.class);
    }

    public List<String> findBookTypesForOwner(int ownerId) {
        if (!ownerColumnExists()) return List.of();
        return jdbcTemplate.queryForList(
                "SELECT DISTINCT TRIM(type) FROM books WHERE owner_id = ? AND type IS NOT NULL AND TRIM(type) <> '' ORDER BY TRIM(type)",
                String.class,
                ownerId
        );
    }

    public int countBooksForOwner(int ownerId, String search, String title, String author, String type) {
        if (!ownerColumnExists()) return 0;
        QueryParts parts = buildOwnerBookQuery(true, ownerId, search, title, author, type, false);
        Integer count = jdbcTemplate.queryForObject(parts.sql(), Integer.class, parts.args().toArray());
        return count == null ? 0 : count;
    }

    public List<Book> findBooksForOwner(int ownerId,
                                        String search,
                                        String title,
                                        String author,
                                        String type,
                                        boolean orderByVolumeDesc,
                                        int limit,
                                        int offset) {
        if (!ownerColumnExists()) return List.of();
        QueryParts parts = buildOwnerBookQuery(false, ownerId, search, title, author, type, orderByVolumeDesc);
        List<Object> args = new ArrayList<>(parts.args());
        args.add(limit);
        args.add(offset);
        return jdbcTemplate.query(parts.sql(), BookRowMappers.BOOK, args.toArray());
    }

    public List<Book> searchBooksForOwner(int ownerId, String keyword, int limit) {
        return findBooksForOwner(ownerId, keyword, null, null, null, true, limit, 0);
    }

    public int countBooksByType(String type) {
        String sql = "SELECT COUNT(*) FROM books WHERE type = ?";
        Integer cnt = jdbcTemplate.queryForObject(sql, Integer.class, type);
        return cnt == null ? 0 : cnt;
    }

    public int countSearchBooksByKeywordAndType(String keyword, String type) {
        String like = Texts.likePattern(keyword);
        String sql = "SELECT COUNT(*) FROM books WHERE (name LIKE ? OR author LIKE ?) AND type = ?";
        Integer cnt = jdbcTemplate.queryForObject(sql, Integer.class, like, like, type);
        return cnt == null ? 0 : cnt;
    }

    public List<Book> searchBooksByKeywordAndType(String keyword, String type, int limit, int offset) {
        String like = Texts.likePattern(keyword);
        String sql = "SELECT " + BOOK_COLUMNS + " FROM books b " + VOLUME_COUNT_JOIN + " WHERE (b.name LIKE ? OR b.author LIKE ?) AND b.type = ? ORDER BY COALESCE(vc.volume_count, 0) DESC, b.id DESC LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, like, like, type, limit, offset);
    }

    public int countBooksByFilters(String title, String author, String type) {
        QueryParts parts = buildBookFilterQuery(true, title, author, type);
        Integer cnt = jdbcTemplate.queryForObject(parts.sql(), Integer.class, parts.args().toArray());
        return cnt == null ? 0 : cnt;
    }

    public List<Book> findBooksByFiltersOrderByCreatedDesc(String title, String author, String type, int limit, int offset) {
        QueryParts parts = buildBookFilterQuery(false, title, author, type);
        List<Object> args = new ArrayList<>(parts.args());
        args.add(limit);
        args.add(offset);
        return jdbcTemplate.query(parts.sql(), BookRowMappers.BOOK, args.toArray());
    }

    public List<Book> findAllBooksByTypeAndCreatedDesc(String type, int limit, int offset) {
        String sql = "SELECT b.id, b.name, b.author, b.description, CAST(COALESCE(vc.volume_count, 0) AS TEXT) AS totalvolume, b.type, b.cover, NULL AS sync, COALESCE(lv.lastVolumeId, b.id) AS createddate FROM books b " + VOLUME_COUNT_JOIN + LAST_VOLUME_JOIN + " WHERE b.type = ? ORDER BY COALESCE(lv.lastVolumeId, b.id) DESC, b.id DESC LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, type, limit, offset);
    }

    public List<Book> findAllBooksOrderByCreatedDesc(int limit, int offset) {
        String sql = "SELECT b.id, b.name, b.author, b.description, CAST(COALESCE(vc.volume_count, 0) AS TEXT) AS totalvolume, b.type, b.cover, NULL AS sync, COALESCE(lv.lastVolumeId, b.id) AS createddate FROM books b " + VOLUME_COUNT_JOIN + LAST_VOLUME_JOIN + " ORDER BY COALESCE(lv.lastVolumeId, b.id) DESC, b.id DESC LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, limit, offset);
    }

    public int countAllBooks() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books", Integer.class);
        return count == null ? 0 : count;
    }

    public List<Book> findAllBooks() {
        String sql = "SELECT " + BOOK_TABLE_COLUMNS + " FROM books ORDER BY id DESC";
        return jdbcTemplate.query(sql, BookRowMappers.BOOK);
    }

    public Book findBookById(int id) {
        String sql = "SELECT " + BOOK_TABLE_COLUMNS + " FROM books WHERE id = ?";
        try {
            return jdbcTemplate.queryForObject(sql, BookRowMappers.BOOK, id);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public Book findBookByIdForOwner(int id, int ownerId) {
        if (!ownerColumnExists()) return null;
        String sql = "SELECT " + BOOK_TABLE_COLUMNS + " FROM books WHERE id = ? AND owner_id = ?";
        try {
            return jdbcTemplate.queryForObject(sql, BookRowMappers.BOOK, id, ownerId);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public Integer findBookIdByNameAndAuthor(String name, String author) {
        String sql = """
                SELECT id
                FROM books
                WHERE name = ? AND (author = ? OR (author IS NULL AND ? IS NULL))
                LIMIT 1
                """;
        try {
            return jdbcTemplate.queryForObject(sql, Integer.class, name, author, author);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public Integer findBookIdByNameAndAuthorForOwner(String name, String author, int ownerId) {
        if (!ownerColumnExists()) return null;
        String sql = """
                SELECT id
                FROM books
                WHERE owner_id = ? AND name = ? AND (author = ? OR (author IS NULL AND ? IS NULL))
                LIMIT 1
                """;
        try {
            return jdbcTemplate.queryForObject(sql, Integer.class, ownerId, name, author, author);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public int insertBook(String name, String author, String description, String cover, String type, String totalVolume) {
        saveCategory(type);
        KeyHolder keyHolder = new GeneratedKeyHolder();
        String sql = "INSERT INTO books (name, author, description, type, cover, totalvolume) VALUES (?, ?, ?, ?, ?, ?)";
        jdbcTemplate.update(connection -> {
            var ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, Texts.trimToNull(name));
            ps.setString(2, Texts.trimToNull(author));
            ps.setString(3, Texts.trimToNull(description));
            ps.setString(4, Texts.trimToNull(type));
            ps.setString(5, Texts.trimToNull(cover));
            ps.setString(6, Texts.trimToNull(totalVolume));
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) throw new IllegalStateException("Failed to get generated book id.");
        return key.intValue();
    }

    public int insertBookForOwner(int ownerId, String name, String author, String description, String cover, String type, String totalVolume) {
        saveCategory(type);
        KeyHolder keyHolder = new GeneratedKeyHolder();
        String sql = "INSERT INTO books (name, author, description, type, cover, totalvolume, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)";
        jdbcTemplate.update(connection -> {
            var ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, Texts.trimToNull(name));
            ps.setString(2, Texts.trimToNull(author));
            ps.setString(3, Texts.trimToNull(description));
            ps.setString(4, Texts.trimToNull(type));
            ps.setString(5, Texts.trimToNull(cover));
            ps.setString(6, Texts.trimToNull(totalVolume));
            ps.setInt(7, ownerId);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) throw new IllegalStateException("Failed to get generated book id.");
        return key.intValue();
    }

    public void updateBook(int bookId, String name, String author, String description, String cover, String type, String totalVolume) {
        saveCategory(type);
        String sql = """
                UPDATE books
                SET name = ?, author = ?, description = ?, cover = ?, type = ?, totalvolume = ?
                WHERE id = ?
                """;
        jdbcTemplate.update(sql, Texts.trimToNull(name), Texts.trimToNull(author), Texts.trimToNull(description), Texts.trimToNull(cover), Texts.trimToNull(type), Texts.trimToNull(totalVolume), bookId);
    }

    public void deleteBookById(int bookId) {
        jdbcTemplate.update("DELETE FROM books WHERE id = ?", bookId);
    }

    public int countByCover(String cover) {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books WHERE cover = ?", Integer.class, Texts.trimToNull(cover));
        return count == null ? 0 : count;
    }

    public void saveCategory(String category) {
        String normalizedCategory = Texts.trimToNull(category);
        if (normalizedCategory == null) {
            return;
        }
        jdbcTemplate.update("INSERT OR IGNORE INTO book_categories (name) VALUES (?)", normalizedCategory);
    }

    private QueryParts buildBookFilterQuery(boolean countOnly, String title, String author, String type) {
        String normalizedTitle = Texts.trimToNull(title);
        String normalizedAuthor = Texts.trimToNull(author);
        String normalizedType = Texts.trimToNull(type);

        StringBuilder sql = new StringBuilder();
        List<Object> args = new ArrayList<>();

        if (countOnly) {
            sql.append("SELECT COUNT(*) ");
        } else {
            sql.append("SELECT b.id, b.name, b.author, b.description, CAST(COALESCE(vc.volume_count, 0) AS TEXT) AS totalvolume, b.type, b.cover, NULL AS sync, COALESCE(lv.lastVolumeId, b.id) AS createddate ");
        }

        sql.append("FROM books b ");
        if (!countOnly) {
            sql.append(VOLUME_COUNT_JOIN);
            sql.append(LAST_VOLUME_JOIN);
        }
        sql.append("WHERE 1=1 ");

        if (normalizedType != null) {
            sql.append("AND b.type = ? ");
            args.add(normalizedType);
        }
        if (normalizedAuthor != null) {
            sql.append("AND b.author LIKE ? ");
            args.add(Texts.likePattern(normalizedAuthor));
        }
        if (normalizedTitle != null) {
            sql.append("AND b.name LIKE ? ");
            args.add(Texts.likePattern(normalizedTitle));
        }

        if (!countOnly) {
            sql.append("ORDER BY COALESCE(lv.lastVolumeId, b.id) DESC, b.id DESC LIMIT ? OFFSET ?");
        }

        return new QueryParts(sql.toString(), args);
    }

    private QueryParts buildOwnerBookQuery(boolean countOnly,
                                           int ownerId,
                                           String search,
                                           String title,
                                           String author,
                                           String type,
                                           boolean orderByVolumeDesc) {
        String normalizedSearch = Texts.trimToNull(search);
        String normalizedTitle = Texts.trimToNull(title);
        String normalizedAuthor = Texts.trimToNull(author);
        String normalizedType = Texts.trimToNull(type);
        StringBuilder sql = new StringBuilder();
        List<Object> args = new ArrayList<>();
        if (countOnly) {
            sql.append("SELECT COUNT(*) FROM books b ");
        } else {
            sql.append("SELECT ").append(BOOK_COLUMNS).append(" FROM books b ")
                    .append(VOLUME_COUNT_JOIN).append(LAST_VOLUME_JOIN);
        }
        sql.append("WHERE b.owner_id = ? ");
        args.add(ownerId);
        if (normalizedSearch != null) {
            sql.append("AND (b.name LIKE ? OR b.author LIKE ?) ");
            String like = Texts.likePattern(normalizedSearch);
            args.add(like);
            args.add(like);
        }
        if (normalizedTitle != null) {
            sql.append("AND b.name LIKE ? ");
            args.add(Texts.likePattern(normalizedTitle));
        }
        if (normalizedAuthor != null) {
            sql.append("AND b.author LIKE ? ");
            args.add(Texts.likePattern(normalizedAuthor));
        }
        if (normalizedType != null) {
            sql.append("AND b.type = ? ");
            args.add(normalizedType);
        }
        if (!countOnly) {
            sql.append(orderByVolumeDesc
                    ? "ORDER BY COALESCE(vc.volume_count, 0) DESC, b.id DESC LIMIT ? OFFSET ?"
                    : "ORDER BY COALESCE(lv.lastVolumeId, b.id) DESC, b.id DESC LIMIT ? OFFSET ?");
        }
        return new QueryParts(sql.toString(), args);
    }

    private boolean ownerColumnExists() {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pragma_table_info('books') WHERE name = 'owner_id'",
                Integer.class
        );
        return count != null && count > 0;
    }

    private record QueryParts(String sql, List<Object> args) {
    }
}
