# Bookshelf 4.1.0

책장 검색을 책·시리즈 단위와 개별 권 단위로 분리한 기능 릴리즈. 현재는 main 승격 및 출시 준비 단계이며 태그·GitHub Release·Docker 이미지 발행은 별도 진행.

## 변경 내용

- 책장에 **일반 책 검색 / 책 상세 검색** 전환 추가. 일반 검색은 기존 책·시리즈 제목과 저자로 검색.
- 상세 검색은 개별 권 제목·저자·ISBN10·ISBN13을 검색하고, 소속 책·권차·저자·ISBN·구매 상태·가격을 권별로 표시.
- ISBN이 없는 권도 제목과 저자로 검색 가능. 분류 조건과 계정별 데이터 격리 유지.
- 페이지 이동·새로고침·브라우저 뒤로 가기·책 상세에서 이전 목록으로 복귀할 때 검색 방식과 조건 유지. 초기화 시 현재 검색 방식은 유지하고 조건 해제.
- 책 상세 페이지의 직접 추가 폼에서 `권 제목`을 `제목`, `권 추가` 버튼을 `추가`로 변경.
- 4.0.1의 소장 도서 선택 차단 및 main의 ISBN 중복 등록 보완 유지.

## 기존 설치 업데이트

DB 스키마 변경 없음(버전 7 유지). 기존 `.env`·DB·표지·백업·데이터 볼륨을 유지하고 웹·워커에 같은 버전 사용. Java 데이터 이전은 [이전 안내](ONE_CLICK_MIGRATION.md) 참고.

아래 명령은 `v4.1.0` GitHub Release와 `trstyq/bookshelf:4.1.0` 이미지 발행을 확인한 뒤 실행.

```sh
BOOKSHELF_IMAGE=trstyq/bookshelf:4.1.0 docker compose -f docker-compose.release.yml pull
BOOKSHELF_IMAGE=trstyq/bookshelf:4.1.0 docker compose -f docker-compose.release.yml up -d
```

업데이트 전 DB와 표지를 같은 시점으로 백업. 롤백 시 웹·워커를 중지하고 기존 4.0.1 이미지와 백업 DB·표지를 함께 복원. 기존 알라딘 공개 페이지 연동의 지원 범위와 제약은 [4.0.0 변경 내용](RELEASE_4.0.0.md) 참고.

## 검증 및 발행 상태

릴리즈 브랜치의 실행 결과는 [4.1.0 준비 기록](WORKLOG_4.1.0.md)에 기록. main 병합, 태그·GitHub Release, Docker 이미지 발행, 운영 컨테이너 교체는 각각 별도 단계.
