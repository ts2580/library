-- bookshelf 스키마에 branchbook 테이블 추가 (Salesforce branchbook__c → bookshelf.branchbook)
-- __c 컬럼 제거 버전

CREATE TABLE IF NOT EXISTS branchbook (
    id INT NOT NULL AUTO_INCREMENT,
    booklink VARCHAR(255) NULL,
    branch VARCHAR(80) NULL,
    uuid VARCHAR(255) NULL,
    volume DOUBLE NULL,
    name VARCHAR(80) NULL,
    price VARCHAR(30) NULL,
    branchname VARCHAR(80) NULL,
    grade VARCHAR(20) NULL,
    createddate TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    book INT NULL,
    systemmodstamp TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT branchbook_pkey PRIMARY KEY (id),
    CONSTRAINT fk_branchbook_book FOREIGN KEY (book) REFERENCES books(id) ON DELETE CASCADE,
    UNIQUE KEY uq_branchbook_uuid (uuid)
);

CREATE INDEX IF NOT EXISTS idx_branchbook_book ON branchbook (book);
