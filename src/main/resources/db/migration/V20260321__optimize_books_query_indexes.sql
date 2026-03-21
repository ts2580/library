CREATE INDEX IF NOT EXISTS idx_books_type ON books (type);
CREATE INDEX IF NOT EXISTS idx_books_type_id ON books (type(191), id);
CREATE FULLTEXT INDEX IF NOT EXISTS idx_books_name_author_fts ON books (name, author);
