package com.example.bookshelf.user.repository;

import com.example.bookshelf.user.model.BookVolume;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Repository
public class BookVolumeRepository {

    private final JdbcTemplate jdbcTemplate;

    public BookVolumeRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public int countAllBookVolumes() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes", Integer.class);
        return count == null ? 0 : count;
    }

    public int countVolumeSearchByKeyword(String keyword) {
        String like = '%' + keyword + '%';
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE name LIKE ? OR isbn13 LIKE ?", Integer.class, like, like);
        return count == null ? 0 : count;
    }

    public List<BookVolume> searchVolumesByKeyword(String keyword, int limit, int offset) {
        String like = '%' + keyword + '%';
        String sql = """
                SELECT id, volume AS seq, book, isbn13, name, cover, price, ispurchased, volume
                FROM book_volumes
                WHERE name LIKE ? OR isbn13 LIKE ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """;
        return jdbcTemplate.query(sql, BookRowMappers.BOOK_VOLUME, like, like, limit, offset);
    }

    public List<BookVolume> findAllVolumesOrderByIdDesc(int limit, int offset) {
        String sql = "SELECT id, volume AS seq, book, isbn13, name, cover, price, ispurchased, volume FROM book_volumes ORDER BY id DESC LIMIT ? OFFSET ?";
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
        Integer cnt = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_volumes WHERE isbn13 = ?", Integer.class, isbn13 == null ? "" : isbn13);
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
        jdbcTemplate.update(sql, bookId, isbn13, name, cover, price, false, seq);
    }

    public void updateVolume(int bookId, int volumeId, String isbn13, String name, String cover, String price, boolean purchased, Integer seq) {
        String sql = """
                UPDATE book_volumes
                SET isbn13 = ?, name = ?, cover = ?, price = ?, ispurchased = ?, volume = ?
                WHERE id = ? AND book = ?
                """;
        jdbcTemplate.update(sql, normalize(isbn13), normalize(name), normalize(cover), normalize(price), purchased, seq, volumeId, bookId);
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

    private String normalize(String value) {
        return (value == null || value.trim().isEmpty()) ? null : value.trim();
    }
}
