package com.example.bookshelf.user.repository;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import static org.assertj.core.api.Assertions.assertThat;

class OwnershipScopeRepositoryTest {

    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbcTemplate;
    private BookDataRepository bookDataRepository;
    private BookVolumeRepository bookVolumeRepository;

    @BeforeEach
    void setUp() {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);
        jdbcTemplate = new JdbcTemplate(dataSource);
        bookDataRepository = new BookDataRepository(jdbcTemplate);
        bookVolumeRepository = new BookVolumeRepository(jdbcTemplate);
        jdbcTemplate.update("INSERT INTO member (id, username, password_hash) VALUES (1, 'owner-a', 'x'), (2, 'owner-b', 'x')");
        jdbcTemplate.update("INSERT INTO books (id, name, author, owner_id) VALUES (10, 'A의 책', '작가', 1), (20, 'B의 책', '작가', 2)");
        jdbcTemplate.update("INSERT INTO book_volumes (id, book, volume, isbn13, name, ispurchased) VALUES (100, 10, 1, '9780000000001', 'A의 책 1', 0), (200, 20, 1, '9780000000001', 'B의 책 1', 0)");
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void bookQueriesOnlyReturnCurrentOwnersData() {
        assertThat(bookDataRepository.findBookByIdForOwner(10, 1)).isNotNull();
        assertThat(bookDataRepository.findBookByIdForOwner(20, 1)).isNull();
        assertThat(bookDataRepository.countBooksForOwner(1, null, null, null, null)).isEqualTo(1);
        assertThat(bookDataRepository.findBooksForOwner(1, null, null, null, null, false, 20, 0))
                .extracting("id")
                .containsExactly(10);
    }

    @Test
    void volumeAndIsbnQueriesAreScopedPerOwner() {
        assertThat(bookVolumeRepository.countAllBookVolumesForOwner(1)).isEqualTo(1);
        assertThat(bookVolumeRepository.findAllVolumesForOwner(1, "id", 20, 0))
                .extracting("bookId")
                .containsExactly(10);
        assertThat(bookVolumeRepository.existsVolumeByIsbn13ForOwner(1, "9780000000001")).isTrue();
        assertThat(bookVolumeRepository.existsVolumeByIsbn13ForOwner(2, "9780000000001")).isTrue();
    }
}
