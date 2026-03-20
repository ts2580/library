-- 지점명에서 상태(grade)를 분리해서 저장
-- 기존 데이터는 "점명 (중)" 형태가 섞여 있을 수 있어 분리 후 정규화

ALTER TABLE branchbook
    ADD COLUMN IF NOT EXISTS grade VARCHAR(20) NULL;

UPDATE branchbook
SET
    grade = NULLIF(
        NULLIF(TRIM(REPLACE(SUBSTRING(branchname, LOCATE('(', branchname) + 1, CHAR_LENGTH(branchname)), ')', '')), ''),
    branchname = CASE
        WHEN LOCATE('(', branchname) > 0
        THEN TRIM(SUBSTRING(branchname, 1, LOCATE('(', branchname) - 1))
        ELSE branchname
    END
WHERE branchname LIKE '%(%';