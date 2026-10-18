# 3.0.0-ca3 루트 전환

이 문서는 PR #30의 최초 변경·검증 기록입니다. 후속 데이터 경로 통일에서는 로컬 `data/`와 Docker `/data`를 사용하며, 아래 `/app/data`·`next/data` 호환 방식은 당시 기록입니다. 현재 전환 절차는 [Java 이전과 ca3 전환](ONE_CLICK_MIGRATION.md), 변경 후 검증은 [데이터 경로 통일](DATA_DIRECTORY.md)을 따릅니다.

## 변경 범위

- Next.js 패키지·앱·컴포넌트·기능·DB·워커·스크립트·검사를 프로젝트 루트로 이동.
- Java 소스·Thymeleaf/정적 자산·Gradle·Java npm/CSS 빌드·셸 실행기와 이전 전용 컨테이너/실행기 제거.
- 루트 Dockerfile은 Node 22 기반 Next 웹·워커 이미지이며 내부 포트 `25647`, 데이터 `/app/data`, UID/GID `1001:1001` 유지.
- `3.0.0-ca3` 패키지 버전과 새 설치용/기존 외부 볼륨용 Compose 분리.
- 루트 또는 기존 `next/data`의 활성 이전본 인식. 데이터 파일 자동 이동·삭제 없음.
- 이전 완료 DB·원본 정리·계정·비밀번호·Excel·표지 경로 호환 유지. Java 이전은 발행된 ca2 migration 이미지와 태그로 제공.

## 검증

2026-10-17 KST, 별도 `refactor/next-root-ca3` worktree에서 현재 소스로 실행했습니다. 이전 ca2 수치를 재사용하지 않았습니다.

| 검사 | 결과 |
|---|---|
| 루트 문법·로컬 import·Client/Server 경계·TypeScript | 통과 |
| Vitest 단위·통합 | 13개 파일, 126개 통과 |
| 루트 프로덕션 빌드 | 통과 |
| Playwright 주요 기능 | 데스크톱 33개 + 모바일 33개, 66개 통과 |
| Playwright 신규 가입 | 데스크톱·모바일 각 1개, 2개 통과 |
| 루트 Docker 빌드 | Node 22.23.3, 패키지 `3.0.0-ca3`, UID 1001 확인 |
| Docker 웹·워커 | 공유 볼륨, 로그인 화면 200, 비인증 API 401, DB 무결성·외래키 검사 통과 |
| Docker 기존 이전본·원본 정리 | 기존 계정 로그인, 실제 삭제 버튼, 원본 DB·표지만 제거, 새 책·표지·자동 백업 유지 확인 |
| ca2 로컬 데이터 경로 | 루트 CLI가 기존 `next/data` 회원·책을 읽고 원래 루트 데이터 파일을 그대로 보존함 확인 |
| Compose | 두 구성의 웹·워커 공유 `/app/data`, 내부 포트 25647, 호스트 포트 변경, 기존 external 볼륨 연결 확인 |
| ca2 볼륨 변수 호환 | `BOOKSHELF_DATA_VOLUME` → `BOOKSHELF_NEXT_VOLUME` → `Bookshelf-next` 우선순위, 빈 값·미설정·셸 환경변수 조합 10개 통과. 웹·워커 공유 및 원본 external 볼륨 유지 확인 |
| 이동 보존 확인 | 앱·컴포넌트·기능·DB·워커·공통 코드 중 120개 파일의 이동 전후 해시 동일 |

기능·데이터 검사는 임시 DB·계정·표지만 사용했습니다. Playwright의 알라딘 응답은 fixture이며 실제 외부 재고 조회 전체를 검증한 결과는 아닙니다. Java 이전 실행기 검사는 ca2에 남기고, 활성 이전본 경로 검사는 별도 단위 검사로 보존·확장했습니다.

로컬 Docker 검증 이미지 ID: `sha256:d42df53a9cd2f2574b45c12e5353188245a8a04ca901a6cb37a91366cf852f82`.

재현 명령은 루트 README에 있으며, 로그와 결과 JSON은 `/tmp/bookshelf-ca3-evidence/`에 보관했습니다.

## 배포 범위

ca3 PR 준비이며 이미지·태그·GitHub Release 발행과 운영 서비스 교체는 포함하지 않습니다. 개발 중인 기본 작업 공간과 실제 데이터는 변경하지 않고 별도 worktree에서 검증합니다.
