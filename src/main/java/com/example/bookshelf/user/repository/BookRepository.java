package com.example.bookshelf.user.repository;

import com.example.bookshelf.integration.aladin.AladinBranchStock;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.model.BranchInventorySummary;
import com.example.bookshelf.user.model.BranchStockItem;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;

@Repository
public class BookRepository {

    private static final int DEFAULT_PAGE_SIZE = 20;

    private final JdbcTemplate jdbcTemplate;

    public BookRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Book> searchBooksByKeywordOrderByVolumeDesc(String keyword, int limit, int offset) {
        String like = '%' + keyword + '%';
        String sql = """
                SELECT b.id, b.name, b.author, b.description, b.totalvolume, b.type, b.cover, NULL AS `sync`, b.createddate
                FROM books b
                LEFT JOIN (
                    SELECT book, COUNT(*) AS volume_count
                    FROM book_volumes
                    WHERE book IS NOT NULL
                    GROUP BY book
                ) v ON v.book = b.id
                WHERE b.name LIKE ? OR b.author LIKE ?
                ORDER BY COALESCE(v.volume_count, 0) DESC, b.id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, like, like, limit, offset);
    }

    public int countSearchBooksByKeyword(String keyword) {
        String like = '%' + keyword + '%';
        String sql = "SELECT COUNT(*) FROM books WHERE name LIKE ? OR author LIKE ?";
        Integer cnt = jdbcTemplate.queryForObject(sql, Integer.class, like, like);
        return cnt == null ? 0 : cnt;
    }

    public List<Book> findAllBooksOrderByVolumeDesc(int limit, int offset) {
        String sql = """
                SELECT b.id, b.name, b.author, b.description, b.totalvolume, b.type, b.cover, NULL AS `sync`, b.createddate
                FROM books b
                LEFT JOIN (
                    SELECT book, COUNT(*) AS volume_count
                    FROM book_volumes
                    WHERE book IS NOT NULL
                    GROUP BY book
                ) v ON v.book = b.id
                ORDER BY COALESCE(v.volume_count, 0) DESC, b.id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK, limit, offset);
    }

    public List<Book> findAllBooksOrderByCreatedDesc(int limit, int offset) {
        String sql = """
                SELECT
                    b.id,
                    b.name,
                    b.author,
                    b.description,
                    b.totalvolume,
                    b.type,
                    b.cover,
                    NULL AS `sync`,
                    COALESCE(v.lastVolumeId, b.id) AS createddate
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

    public int countAllBookVolumes() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes", Integer.class);
        return count == null ? 0 : count;
    }

    public List<Book> findAllBooks() {
        String sql = """
                SELECT id, name, author, description, totalvolume, type, cover, NULL AS `sync`, createddate
                FROM books
                ORDER BY id DESC
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK);
    }

    public List<Book> searchBooksByKeyword(String keyword) {
        return searchBooksByKeywordOrderByVolumeDesc(keyword, 1_000_000, 0);
    }

    public Book findBookById(int id) {
        String sql = """
                SELECT id, name, author, description, totalvolume, type, cover, NULL AS `sync`, createddate
                FROM books
                WHERE id = ?
                """;
        try {
            return jdbcTemplate.queryForObject(sql, BookRowMappers.BOOK, id);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public List<BookVolume> findUnpurchasedVolumes() {
        String sql = """
                SELECT id, volume AS seq, book, isbn13, name, cover, price, ispurchased, volume
                FROM book_volumes
                WHERE ispurchased = FALSE
                ORDER BY id ASC
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME);
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

    public List<BranchInventorySummary> findBranchInventorySummaries() {
        String sql = """
                SELECT
                    COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN') AS branch,
                    COALESCE(NULLIF(bb.branchname, ''), COALESCE(NULLIF(bb.branch, ''), '지점')) AS branchName,
                    COUNT(*) AS stockCount,
                    SUM(CASE WHEN bb.price IS NOT NULL AND bb.price REGEXP '^[0-9,]+$' THEN CAST(REPLACE(bb.price, ',', '') AS UNSIGNED) ELSE 0 END) AS totalAmount,
                    SUM(CASE WHEN bb.price IS NOT NULL AND bb.price REGEXP '^[0-9,]+$' THEN 1 ELSE 0 END) AS pricedCount
                FROM branchbook bb
                GROUP BY COALESCE(NULLIF(bb.branch, ''), 'UNKNOWN'), COALESCE(NULLIF(bb.branchname, ''), COALESCE(NULLIF(bb.branch, ''), '지점'))
                HAVING COUNT(*) > 0
                ORDER BY totalAmount DESC, stockCount DESC
                """;
        return jdbcTemplate.query(sql, (rs, rowNum) -> new BranchInventorySummary(
                rs.getString("branch"),
                rs.getString("branchName"),
                rs.getInt("stockCount"),
                rs.getLong("totalAmount"),
                rs.getInt("pricedCount")
        ));
    }

    public List<BranchStockItem> findStocksByBranch(String branch) {
        String sql = """
                SELECT
                    bb.id,
                    bb.branch,
                    bb.branchname,
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
                LEFT JOIN book_volumes bv ON bv.book = bb.book AND bv.volume = bb.volume
                WHERE bb.branch = ?
                ORDER BY COALESCE(NULLIF(bb.grade, ''), 'ZZZ'), bv.name ASC
                """;
        return jdbcTemplate.query(sql, (rs, rowNum) -> new BranchStockItem(
                rs.getInt("id"),
                rs.getString("branch"),
                rs.getString("branchname"),
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

    public List<BranchStockItem> findStocksByBranchCode(String branch) {
        return findStocksByBranch(branch);
    }

    public Integer findBookIdByNameAndAuthor(String name, String author) {
        String sql = "SELECT id FROM books WHERE name = ? AND author = ? LIMIT 1";
        try {
            return jdbcTemplate.queryForObject(sql, Integer.class, name, author);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public boolean existsVolumeByIsbn13(String isbn13) {
        Integer cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM book_volumes WHERE isbn13 = ?",
                Integer.class,
                isbn13 == null ? "" : isbn13
        );
        return cnt != null && cnt > 0;
    }

    public int insertBook(String name, String author, String description, String cover, String type) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        String sql = "INSERT INTO books (name, author, description, type, cover) VALUES (?, ?, ?, ?, ?)";
        jdbcTemplate.update(connection -> {
            var ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, name);
            ps.setString(2, author);
            ps.setString(3, description);
            ps.setString(4, type);
            ps.setString(5, cover);
            return ps;
        }, keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to get generated book id.");
        }
        return key.intValue();
    }

    public void deleteBranchBooksByBookAndVolume(int bookId, int volume) {
        jdbcTemplate.update("DELETE FROM branchbook WHERE book = ? AND volume = ?", bookId, volume);
    }

    public void insertBranchBook(int bookId,
                                 String bookName,
                                 String branch,
                                 String branchName,
                                 String grade,
                                 String bookLink,
                                 String purchaseLink,
                                 String price,
                                 int volume,
                                 String uuid) {
        String sql = """
                INSERT INTO branchbook (booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE price = VALUES(price), purchaseurl = VALUES(purchaseurl), name = VALUES(name), branchname = VALUES(branchname), grade = VALUES(grade), volume = VALUES(volume)
                """;
        jdbcTemplate.update(sql,
                bookLink,
                purchaseLink,
                branch,
                uuid,
                (double) volume,
                bookName,
                price,
                branchName,
                grade,
                bookId
        );
    }

    public void insertBranchBooks(int bookId,
                                  String bookName,
                                  int volume,
                                  List<AladinBranchStock> stocks) {
        if (stocks == null || stocks.isEmpty()) {
            return;
        }
        String sql = """
                INSERT INTO branchbook (booklink, purchaseurl, branch, uuid, volume, name, price, branchname, grade, book)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE price = VALUES(price), purchaseurl = VALUES(purchaseurl), name = VALUES(name), branchname = VALUES(branchname), grade = VALUES(grade), volume = VALUES(volume)
                """;
        jdbcTemplate.batchUpdate(sql, stocks, stocks.size(), (ps, stock) -> {
            String uuid = makeBranchBookUuid(
                    bookId,
                    stock.branch(),
                    stock.branchName(),
                    stock.grade(),
                    stock.volume() > 0 ? stock.volume() : volume,
                    stock.bookLink()
            );
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

    public String makeBranchBookUuid(int bookId,
                                     String branch,
                                     String branchName,
                                     String grade,
                                     double volume,
                                     String bookLink) {
        String raw = bookId + "|" + volume + "|" + safeNormalize(branch) + "|" + safeNormalize(branchName) + "|" + safeNormalize(grade) + "|" + safeNormalize(bookLink);
        return UUID.nameUUIDFromBytes(raw.getBytes(StandardCharsets.UTF_8)).toString();
    }

    public int nextVolumeSeq(int bookId) {
        Integer seq = jdbcTemplate.queryForObject(
                "SELECT COALESCE(MAX(volume), 0) + 1 FROM book_volumes WHERE book = ?",
                Integer.class,
                bookId
        );
        return seq == null ? 1 : seq;
    }

    public void insertVolume(int bookId, int seq, String isbn13, String name, String cover, String price) {
        String sql = """
                INSERT INTO book_volumes
                (book, isbn13, name, cover, price, ispurchased, volume, createddate)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                """;
        jdbcTemplate.update(sql,
                bookId,
                isbn13,
                name,
                cover,
                price,
                false,
                seq
        );
    }

    public int defaultPageSize() {
        return DEFAULT_PAGE_SIZE;
    }

    private String normalize(String value) {
        return (value == null || value.trim().isEmpty()) ? null : value.trim();
    }

    private String safeNormalize(String value) {
        String normalized = normalize(value);
        return normalized == null ? "" : normalized;
    }
}
