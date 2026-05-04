PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    totalvolume TEXT,
    description TEXT,
    sync TEXT,
    type TEXT,
    name TEXT,
    cover TEXT,
    isdeleted INTEGER,
    systemmodstamp TEXT,
    order_no TEXT,
    createddate TEXT DEFAULT CURRENT_TIMESTAMP,
    author TEXT,
    createdbyid TEXT,
    encrypt TEXT,
    sfid TEXT,
    hc_lastop TEXT,
    hc_err TEXT
);

CREATE INDEX IF NOT EXISTS idx_books_name ON books (name);
CREATE INDEX IF NOT EXISTS idx_books_author ON books (author);
CREATE INDEX IF NOT EXISTS idx_books_type ON books (type);
CREATE INDEX IF NOT EXISTS idx_books_type_id ON books (type, id);

CREATE TABLE IF NOT EXISTS member (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    name TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS book_volumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seq INTEGER,
    book INTEGER NOT NULL,
    cover TEXT,
    isbn13 TEXT,
    price TEXT,
    ispurchased INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    type TEXT,
    volume INTEGER,
    noneedtobuy INTEGER DEFAULT 0,
    isbn TEXT,
    description TEXT,
    link TEXT,
    pubdate TEXT,
    createddate TEXT,
    author TEXT,
    FOREIGN KEY (book) REFERENCES books (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_volumes_book ON book_volumes (book);
CREATE INDEX IF NOT EXISTS idx_book_volumes_book_volume ON book_volumes (book, volume);
CREATE INDEX IF NOT EXISTS idx_book_volumes_isbn13 ON book_volumes (isbn13);
CREATE INDEX IF NOT EXISTS idx_book_volumes_ispurchased ON book_volumes (ispurchased);
CREATE INDEX IF NOT EXISTS idx_book_volumes_createddate ON book_volumes (createddate);

CREATE TABLE IF NOT EXISTS branchbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booklink TEXT,
    purchaseurl TEXT,
    branch TEXT,
    uuid TEXT UNIQUE,
    volume REAL,
    name TEXT,
    price TEXT,
    branchname TEXT,
    grade TEXT,
    createddate TEXT DEFAULT CURRENT_TIMESTAMP,
    book INTEGER,
    systemmodstamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_branchbook_book ON branchbook (book);
CREATE INDEX IF NOT EXISTS idx_branchbook_branch ON branchbook (branch);
CREATE INDEX IF NOT EXISTS idx_branchbook_book_volume ON branchbook (book, volume);

CREATE TABLE IF NOT EXISTS branch_inventory_summary (
    branch TEXT NOT NULL PRIMARY KEY,
    branch_name TEXT NOT NULL,
    stock_count INTEGER NOT NULL DEFAULT 0,
    priced_count INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_branch_inventory_summary_total_amount ON branch_inventory_summary (total_amount);
CREATE INDEX IF NOT EXISTS idx_branch_inventory_summary_updated_at ON branch_inventory_summary (updated_at);
