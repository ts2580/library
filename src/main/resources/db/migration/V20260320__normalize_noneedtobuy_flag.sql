-- noneedtobuy는 내부적으로 TINYINT(1)로 유지하고, bool처럼 취급
-- (TRUE/FALSE 대화 표현 대비, 실제 DB 저장값은 MariaDB TINYINT(1))

ALTER TABLE book_volumes
    MODIFY COLUMN noneedtobuy TINYINT(1) NULL DEFAULT FALSE;

UPDATE book_volumes
SET noneedtobuy = COALESCE(noneedtobuy, 0);
