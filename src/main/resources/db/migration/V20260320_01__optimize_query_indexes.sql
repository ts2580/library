CREATE INDEX IF NOT EXISTS idx_book_volumes_book_volume ON book_volumes (book, volume);
CREATE INDEX IF NOT EXISTS idx_book_volumes_isbn13 ON book_volumes (isbn13);
CREATE INDEX IF NOT EXISTS idx_branchbook_branch ON branchbook (branch);
CREATE INDEX IF NOT EXISTS idx_branchbook_book_volume ON branchbook (book, volume);
