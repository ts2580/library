ALTER TABLE book_volumes
    ADD COLUMN createddate DATETIME NULL;

CREATE INDEX idx_book_volumes_createddate ON book_volumes (createddate);
