package com.example.bookshelf.user.repository;

/**
 * @deprecated Repository responsibilities were split into:
 * - {@link BookDataRepository}
 * - {@link BookVolumeRepository}
 * - {@link BranchInventoryRepository}
 *
 * This class is intentionally kept as a non-bean placeholder only,
 * to make the retirement explicit and avoid accidental reintroduction.
 */
@Deprecated(forRemoval = false)
public final class BookRepository {
    private BookRepository() {
        throw new UnsupportedOperationException("Use BookDataRepository, BookVolumeRepository, or BranchInventoryRepository instead.");
    }
}
