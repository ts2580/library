-- bookshelf.book_volumes.ispurchased 컬럼을 bool(boolean) 타입으로 정리
-- 기존 값 0/1을 그대로 유지하면서, 컬럼 타입만 BOOLEAN으로 변환

ALTER TABLE book_volumes
    MODIFY COLUMN ispurchased BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE book_volumes
SET ispurchased = COALESCE(ispurchased, 0);

CREATE INDEX IF NOT EXISTS idx_book_volumes_ispurchased
    ON book_volumes (ispurchased);
