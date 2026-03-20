-- 지점 재고 직접 구매 링크 저장용 필드 추가

ALTER TABLE branchbook
    ADD COLUMN IF NOT EXISTS purchaseurl VARCHAR(255) NULL;

UPDATE branchbook
SET purchaseurl = booklink
WHERE purchaseurl IS NULL;
