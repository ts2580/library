# 데이터 경로 통일

애플리케이션 데이터는 로컬 `data/`, Docker `/data`를 기준으로 관리합니다. 소스는 프로젝트 루트에 있으며 실행에 `next/` 폴더가 필요하지 않습니다.

| 항목 | 로컬 | Docker |
|---|---|---|
| 데이터 루트 | `<project>/data` | `/data` |
| 새 설치 DB | `data/bookshelf.sqlite` | `/data/bookshelf.sqlite` |
| 기존 이전본 | `data/migrations/handover-*` | `/data/migrations/handover-*` |
| Java 원본·백업·로그 | `data/legacy` | `/data/legacy` |

DB·표지·업로드·자동 백업은 선택한 새 설치 또는 이전본 디렉터리 안에서 함께 관리합니다. 기존 `active-migration.json`의 상대 경로는 데이터 루트를 기준으로 해석하므로 Docker 작업 디렉터리 `/app`에 의존하지 않습니다.

`BOOKSHELF_DATA_DIR`만 지정하면 그 안에서 DB와 원본 보관 경로를 계산합니다. 별도 `BOOKSHELF_DB_PATH`는 명시적으로 다른 DB를 선택할 때 사용합니다. 두 Compose 파일은 로컬 `.env`의 경로보다 `/data` 설정을 우선하며 웹·워커가 같은 볼륨을 공유합니다.

기존 Docker 볼륨 이름은 유지합니다. `BOOKSHELF_DATA_VOLUME`이 비어 있으면 ca2의 `BOOKSHELF_NEXT_VOLUME`, 둘 다 비어 있으면 `Bookshelf-next`를 사용합니다. 기존 로컬 데이터 이동과 이미지별 마운트 위치는 [전환 안내](ONE_CLICK_MIGRATION.md)를 따릅니다.

## 검증

2026-10-17, 경로 통일 변경 후 로컬 검증 기록입니다.

- 문법·구조·타입 검사 및 단위·통합 검사 132개 통과.
- 로컬 프로덕션 빌드와 Node 22 Docker 빌드 통과.
- Compose 설정 16개 조합에서 `/data` 공유, 기존 볼륨 이름 호환, 원본 하위 마운트, 포트 설정 확인.
- Docker 웹·워커가 `/data/bookshelf.sqlite`를 사용하며 로그인 화면·비인증 API 응답·DB 무결성 검사 통과.
- 기존 ca2 이전 기록을 가진 Docker fixture에서 계정 로그인, 실제 원본 삭제 버튼, 이전본·자동 백업 유지, 인증된 표지 요청 확인.
- 로컬 실제 데이터 이동 전후 DB·표지·백업·로그의 파일 해시와 도서 수 유지 확인. 기존 누락 표지는 별도로 집계하고 이동으로 생긴 추가 누락이 없음을 확인.

원격 이미지 발행과 운영 서버 교체는 이 검증에 포함하지 않습니다.
