package com.example.bookshelf.user.repository;

import com.example.bookshelf.user.model.Member;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class MemberRepository {

    private static final String MEMBER_COLUMNS = "id, username, password_hash, email, name, description";

    private final JdbcTemplate jdbcTemplate;

    private final RowMapper<Member> mapper = (rs, rowNum) -> new Member(
            rs.getInt("id"),
            rs.getString("username"),
            rs.getString("password_hash"),
            rs.getString("email"),
            rs.getString("name"),
            rs.getString("description")
    );

    public MemberRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Member findById(int id) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT " + MEMBER_COLUMNS + " FROM member WHERE id = ?",
                    mapper,
                    id
            );
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public Member findByUsername(String username) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT " + MEMBER_COLUMNS + " FROM member WHERE username = ?",
                    mapper,
                    username
            );
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    public boolean existsByUsername(String username) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM member WHERE username = ?",
                Integer.class,
                username
        );
        return count != null && count > 0;
    }

    public void createMember(Member member) {
        String sql = "INSERT INTO member (username, password_hash, email, name, description) VALUES (?, ?, ?, ?, ?)";
        jdbcTemplate.update(sql,
                member.username(),
                member.passwordHash(),
                member.email(),
                member.name(),
                member.description());
    }
}
