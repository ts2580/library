package com.example.bookshelf.user.service;

import com.example.bookshelf.user.model.Member;
import com.example.bookshelf.user.repository.MemberRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class BookOwnershipMigrationService {

    public static final String ADMIN_USERNAME = "trstyq";
    private static final Pattern ITEM_ID_PATTERN = Pattern.compile("(?i)[?&]ItemId=(\\d+)");
    private static final Pattern COVER_PRODUCT_PATTERN = Pattern.compile("(?i)/product/(\\d+)/(\\d+)/");

    private final JdbcTemplate jdbcTemplate;
    private final MemberRepository memberRepository;

    public BookOwnershipMigrationService(JdbcTemplate jdbcTemplate, MemberRepository memberRepository) {
        this.jdbcTemplate = jdbcTemplate;
        this.memberRepository = memberRepository;
    }

    public MigrationStatus status() {
        Member admin = memberRepository.findByUsername(ADMIN_USERNAME);
        int totalBooks = count("SELECT COUNT(*) FROM books");
        if (!ownerColumnExists()) {
            int branchRows = tableExists("branchbook") ? count("SELECT COUNT(*) FROM branchbook") : 0;
            return new MigrationStatus(false, false, admin != null, totalBooks, 0, totalBooks, 0, false, branchRows);
        }
        int assignedToAdmin = admin == null ? 0 : count("SELECT COUNT(*) FROM books WHERE owner_id = ?", admin.id());
        int unassigned = count("SELECT COUNT(*) FROM books WHERE owner_id IS NULL");
        int conflicting = admin == null ? count("SELECT COUNT(*) FROM books WHERE owner_id IS NOT NULL")
                : count("SELECT COUNT(*) FROM books WHERE owner_id IS NOT NULL AND owner_id <> ?", admin.id());
        boolean inventoryColumnPresent = columnExists("branchbook", "book_volume_id");
        int unresolvedInventory = inventoryColumnPresent ? count("SELECT COUNT(*) FROM branchbook WHERE book_volume_id IS NULL") : count("SELECT COUNT(*) FROM branchbook");
        boolean completed = admin != null && unassigned == 0 && conflicting == 0 && inventoryColumnPresent && unresolvedInventory == 0;
        return new MigrationStatus(true, completed, admin != null, totalBooks, assignedToAdmin, unassigned, conflicting,
                inventoryColumnPresent, unresolvedInventory);
    }

    @Transactional
    public MigrationResult migrateExistingBooksToAdmin() {
        Member admin = memberRepository.findByUsername(ADMIN_USERNAME);
        if (admin == null) {
            throw new IllegalStateException("trstyq 계정을 찾을 수 없어 마이그레이션을 중단했습니다.");
        }
        if (!ownerColumnExists()) {
            jdbcTemplate.execute("ALTER TABLE books ADD COLUMN owner_id INTEGER REFERENCES member(id) ON DELETE RESTRICT ON UPDATE CASCADE");
        }
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_books_owner_id ON books(owner_id)");
        jdbcTemplate.execute("DROP INDEX IF EXISTS ux_book_volumes_isbn13_not_blank");
        int conflicting = count("SELECT COUNT(*) FROM books WHERE owner_id IS NOT NULL AND owner_id <> ?", admin.id());
        if (conflicting > 0) {
            throw new IllegalStateException("이미 다른 사용자에게 할당된 책이 " + conflicting + "권 있어 마이그레이션을 중단했습니다.");
        }
        int updated = jdbcTemplate.update("UPDATE books SET owner_id = ? WHERE owner_id IS NULL", admin.id());
        int inventoryUpdated = migrateBranchBookVolumeReferences();
        MigrationStatus status = status();
        if (!status.completed()) {
            throw new IllegalStateException("소유권 마이그레이션 검증에 실패했습니다.");
        }
        return new MigrationResult(updated, status.totalBooks(), admin.id(), ADMIN_USERNAME, inventoryUpdated);
    }

    private boolean ownerColumnExists() {
        return columnExists("books", "owner_id");
    }

    private boolean columnExists(String table, String column) {
        return count("SELECT COUNT(*) FROM pragma_table_info('" + table + "') WHERE name = ?", column) > 0;
    }

    private int migrateBranchBookVolumeReferences() {
        if (!tableExists("branchbook") || !tableExists("book_volumes")) return 0;
        if (!columnExists("branchbook", "book_volume_id")) {
            jdbcTemplate.execute("ALTER TABLE branchbook ADD COLUMN book_volume_id INTEGER REFERENCES book_volumes(id) ON DELETE CASCADE ON UPDATE CASCADE");
        }

        Map<VolumeKey, List<VolumeCandidate>> candidatesByKey = new HashMap<>();
        jdbcTemplate.query("SELECT id, book, volume, name, cover FROM book_volumes", rs -> {
            VolumeCandidate candidate = new VolumeCandidate(
                    rs.getInt("id"), rs.getInt("book"), rs.getDouble("volume"), rs.getString("name"), rs.getString("cover")
            );
            candidatesByKey.computeIfAbsent(new VolumeKey(candidate.bookId(), candidate.volume()), ignored -> new ArrayList<>()).add(candidate);
        });

        List<BranchReference> references = jdbcTemplate.query(
                "SELECT id, book, volume, name, booklink, purchaseurl FROM branchbook WHERE book_volume_id IS NULL",
                (rs, rowNum) -> new BranchReference(
                        rs.getInt("id"), rs.getInt("book"), rs.getDouble("volume"), rs.getString("name"),
                        rs.getString("booklink"), rs.getString("purchaseurl")
                )
        );
        List<Object[]> updates = new ArrayList<>();
        List<Integer> unresolved = new ArrayList<>();
        for (BranchReference reference : references) {
            Integer volumeId = resolveVolumeId(reference, candidatesByKey.getOrDefault(
                    new VolumeKey(reference.bookId(), reference.volume()), List.of()));
            if (volumeId == null) {
                unresolved.add(reference.id());
            } else {
                updates.add(new Object[]{volumeId, reference.id()});
            }
        }
        if (!unresolved.isEmpty()) {
            throw new IllegalStateException("권차를 확정할 수 없는 지점 재고가 " + unresolved.size() + "건 있어 마이그레이션을 중단했습니다. 예시 ID: " + unresolved.stream().limit(5).toList());
        }
        if (!updates.isEmpty()) {
            jdbcTemplate.batchUpdate("UPDATE branchbook SET book_volume_id = ? WHERE id = ?", updates);
        }
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_branchbook_book_volume_id ON branchbook(book_volume_id)");
        return updates.size();
    }

    private Integer resolveVolumeId(BranchReference reference, List<VolumeCandidate> candidates) {
        if (candidates.size() == 1) return candidates.get(0).id();
        if (candidates.isEmpty()) return null;
        String branchName = normalize(reference.name());
        List<VolumeCandidate> nameMatches = candidates.stream()
                .filter(candidate -> normalize(candidate.name()).equals(branchName))
                .toList();
        if (nameMatches.size() == 1) return nameMatches.get(0).id();
        List<VolumeCandidate> productMatches = (nameMatches.isEmpty() ? candidates : nameMatches).stream()
                .filter(candidate -> matchesAladinProduct(reference, candidate))
                .toList();
        return productMatches.size() == 1 ? productMatches.get(0).id() : null;
    }

    private boolean matchesAladinProduct(BranchReference reference, VolumeCandidate candidate) {
        String links = normalize(reference.bookLink()) + " " + normalize(reference.purchaseUrl());
        Matcher itemMatcher = ITEM_ID_PATTERN.matcher(links);
        Matcher coverMatcher = COVER_PRODUCT_PATTERN.matcher(normalize(candidate.cover()));
        if (!itemMatcher.find() || !coverMatcher.find()) return false;
        return itemMatcher.group(1).startsWith(coverMatcher.group(1) + coverMatcher.group(2));
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private boolean tableExists(String table) {
        return count("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", table) > 0;
    }

    private int count(String sql, Object... args) {
        Integer result = jdbcTemplate.queryForObject(sql, Integer.class, args);
        return result == null ? 0 : result;
    }

    public record MigrationStatus(
            boolean ownerColumnPresent,
            boolean completed,
            boolean adminPresent,
            int totalBooks,
            int assignedToAdmin,
            int unassignedBooks,
            int conflictingBooks,
            boolean inventoryReferenceColumnPresent,
            int unresolvedInventoryRows
    ) {
    }

    public record MigrationResult(int updatedBooks, int totalBooks, int ownerId, String ownerUsername, int updatedInventoryRows) {
    }

    private record VolumeKey(int bookId, double volume) {}
    private record VolumeCandidate(int id, int bookId, double volume, String name, String cover) {}
    private record BranchReference(int id, int bookId, double volume, String name, String bookLink, String purchaseUrl) {}
}
