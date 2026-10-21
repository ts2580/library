# Bookshelf

Next.js App Router + React + TypeScript + Drizzle + SQLite로 구성한 책장입니다. **3.1.0 개발 소스는 프로젝트 루트에서 실행**합니다. 웹과 재고·표지 ZIP 처리 워커는 같은 패키지와 DB를 사용하는 별도 프로세스입니다.

## 로컬 실행

Node.js 22 이상이 필요합니다. 기존 설정이 없다면 `.env.example`을 `.env`로 복사하고 `ALADIN_TTB_KEY`를 설정합니다. SQLite 네이티브 모듈을 직접 빌드하는 환경에는 Python 3·make·g++도 필요합니다.

기존 `next/`에서 실행 중인 웹·워커는 종료하고, 데이터가 남아 있으면 [로컬 데이터 이동 절차](docs/ONE_CLICK_MIGRATION.md#이전-완료한-로컬-실행)를 먼저 진행합니다.

```bash
npm ci
npm run dev
# 다른 터미널, 같은 프로젝트 루트에서:
npm run worker:dev
```

주소는 `http://localhost:25647`입니다. 신규 설치의 첫 계정은 `.env`에서 `REGISTRATION=true`로 시작한 뒤 `/signup`에서 만들고, 생성 후 다시 `false`로 설정합니다. 첫 계정은 관리자입니다. 기존 사용자는 이전 계정으로 로그인합니다.

프로덕션 실행은 다음과 같습니다.

```bash
npm run build
npm run start
# 다른 터미널에서:
npm run worker
```

웹·워커·DB CLI는 루트의 `.env`와 동일한 데이터 경로를 사용합니다. 개발 프록시는 `next.config.ts`의 `allowedDevOrigins`로 허용하며, 운영 HTTPS 프록시는 `X-Forwarded-Proto`를 전달합니다. 필요하면 `BOOKSHELF_COOKIE_SECURE=true` 또는 내부 HTTP의 `false`를 지정합니다.

책별 재고 검색·표지 ZIP을 포함한 업데이트에서는 웹과 워커를 같은 코드로 함께 재시작합니다. DB 버전 2는 작업 범위, 버전 3은 실행 ID 컬럼, 버전 4는 계정별 마지막 재고 완료 ID 테이블을 추가하며 기존 재고·권차·사용자 권한을 변경하지 않습니다. 새로 내보내는 표지 ZIP v3은 이 버전의 복원기가 필요하며, 기존 v2 ZIP도 가져올 수 있습니다.

개발 모드는 `experimental.reactDebugChannel=false`로 설정합니다. HMR 웹소켓을 전달하지 못하는 프록시에서도 화면의 버튼과 입력 이벤트가 활성화되도록 하기 위한 설정입니다.

Nginx Proxy Manager로 개발 서버에 접속하면 해당 Proxy Host의 `Edit → Details → Websockets Support`를 켜고 저장합니다. `/_next/hmr`은 개발 중 코드 변경을 전달하는 WebSocket 연결이며, 책 검색·추가 API는 HTTP를 사용합니다. 프록시가 WebSocket 업그레이드를 전달하지 않으면 `GET /_next/hmr?... 404`가 반복되고 개발 클라이언트의 재연결 실패로 페이지가 새로고침될 수 있습니다. 정상 연결은 브라우저 개발자 도구의 Network → WS에서 `101 Switching Protocols`로 확인합니다. 프록시 변경 후 기존 페이지를 새로고침합니다.

알라딘 추가 예정 미리보기는 연결 끊김 또는 HTTP 502·503·504에 한해 GET 요청을 한 번 재시도합니다. 계속 실패하면 선택한 기존 책과 입력값을 유지하고 오류를 표시합니다. 책을 저장하는 POST 요청은 자동 재시도하지 않습니다.

## 기존 ca2 데이터로 전환

DB·표지·업로드·백업은 한 데이터 루트에 보관합니다. 로컬은 프로젝트의 `data/`, Docker 내부는 `/data`입니다. DB 스키마와 기존 Docker 볼륨 이름은 유지하며 컨테이너의 연결 위치만 바꿉니다.

| 환경 | 새 앱 데이터 | 원본 정리용 Java 데이터 |
|---|---|---|
| Docker | 웹·워커 모두 `Bookshelf-next:/data` | 웹에 `Bookshelf:/data/legacy` |
| 로컬 | 프로젝트 루트 `data/` | `data/legacy/` |

**이 소스로 빌드한 이미지에는 새 데이터 볼륨을 `/data`에 연결합니다.** 기존 ca2 Next 전용 이미지는 `/app/data`, ca2 이전용 이미지는 `/app/next/data`를 사용했으므로 이미지 버전과 연결 위치를 함께 변경합니다. 새 빈 볼륨을 만들거나 이전 기록 파일만 따로 옮기지 않습니다. 실제 DB·표지·백업과 `active-migration.json`을 함께 유지합니다.

`BOOKSHELF_DATA_DIR` 기본값은 `./data`이며 DB는 그 안의 `bookshelf.sqlite`를 사용합니다. 원클릭 이전 기록이 있으면 같은 데이터 루트의 `migrations/handover-*`를 선택합니다. `BOOKSHELF_DB_PATH`는 별도 DB를 명시할 때만 설정합니다. `.env`도 루트에서 읽으며, 이동을 마치면 `next/` 폴더는 필요하지 않습니다. 이전 `next/data`만 남은 상태에서 새 빈 DB를 만드는 대신 이동 안내와 함께 시작을 중단합니다.

3.0.0은 Java 소스·Gradle·이전용 실행기를 포함하지 않습니다. 아직 Java 데이터 이전 전이면 [ca2 이전용 이미지와 안내](https://github.com/ts2580/library/releases/tag/v3.0.0-ca2)를 먼저 사용합니다. [이전·전환 절차](docs/ONE_CLICK_MIGRATION.md)에 기존 DB·표지 정리까지 설명했습니다.

## Docker

### 신규 설치·로컬 빌드

루트 `.env`를 준비한 뒤 실행합니다. 이 구성은 새 설치용 `bookshelf-data` 볼륨을 사용합니다.

```bash
docker compose up -d --build
```

컨테이너 내부 웹 포트는 항상 `25647`이며, 호스트 포트는 `SERVER_PORT`로 바꿉니다. 웹·워커는 같은 `/data` 볼륨을 공유하고 UID/GID `1001:1001`로 실행합니다. Compose가 컨테이너 경로를 지정하므로 로컬 `.env`의 `./data` 설정을 그대로 사용할 수 있습니다.

### 기존 Bookshelf-next 볼륨 사용

`docker-compose.release.yml`은 기존 `Bookshelf-next`와 `Bookshelf`를 external volume으로 연결합니다. 실제 이름이 다르면 `.env`의 `BOOKSHELF_DATA_VOLUME`·`BOOKSHELF_LEGACY_VOLUME`을 맞춥니다. 기존 Java·Next 웹·워커를 모두 종료한 뒤 이 구성으로 전환합니다.

발행용 Compose의 `permissions` 작업이 먼저 root로 실행되어 두 데이터 볼륨의 소유권을 UID/GID `1001:1001`로 맞춥니다. 작업 성공 후 웹·워커는 기존처럼 UID 1001로 실행합니다. 심볼릭 링크 대상을 따라가거나 데이터 파일을 삭제하지 않습니다. 기존 Java 이미지의 UID가 달라도 관리자 정리 API가 원본 볼륨에 쓸 수 있도록 하기 위한 단계입니다.

새 데이터 볼륨은 `BOOKSHELF_DATA_VOLUME` → ca2의 `BOOKSHELF_NEXT_VOLUME` → `Bookshelf-next` 순서로 비어 있지 않은 값을 사용합니다. ca2에서 `BOOKSHELF_NEXT_VOLUME`만 지정한 설정도 그대로 사용할 수 있습니다.

현재 발행된 정식 릴리즈는 `trstyq/bookshelf:3.0.0`입니다. `3.1.0`은 canary 병합을 위한 개발 버전이며, 아래 발행용 Compose는 정식 이미지가 발행되기 전까지 `3.0.0`을 사용합니다. 기존 `.env`와 실제 볼륨 이름을 확인하고 이전 웹·워커를 종료한 뒤 함께 교체합니다.

```bash
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

`latest`도 정식 버전을 가리키지만 재현 가능한 업데이트에는 버전 태그를 권장합니다. `restart`만으로는 이미지·볼륨 설정 변경이 적용되지 않습니다. 저장소 이름 변경으로 기존 `next_bookshelf-data` 등을 사용하던 경우에도 실제 볼륨 이름을 지정합니다.

워커는 DB당 하나만 실행합니다. 실행 중 `.worker-lock.sqlite`를 삭제하지 않습니다. SQLite와 워커 잠금은 같은 호스트의 로컬 파일시스템을 사용합니다.

## 구현 범위

- 계정별 도서·권 CRUD와 SQL 수준 `owner_id` 소유권 검사
- 책장에서 보유 권 검색으로 이동, 책 상세에서 비어 있는 저자·설명 자동 보강 및 선택한 권 일괄 삭제
- 기존 BCrypt 및 레거시 SHA-256 로그인 호환. UTF-8 72바이트 이하의 레거시 암호는 로그인 성공 시 BCrypt로 승격하며, 더 긴 기존 SHA-256 암호는 전체 문자열 검증을 유지
- 신규·변경 비밀번호는 UTF-8 72바이트 이하. SQLite 트랜잭션으로 검증한 암호의 유효성 확인·비밀번호 변경·기존 세션 폐기·새 세션 발급 처리
- 로그인 사용자는 프로필에서 공용 카테고리 추가 가능, 삭제는 관리자만 가능. 책에 사용 중인 카테고리는 분류를 변경한 뒤 삭제
- 알라딘 도서 검색·등록, ISBN 중고 재고 조회, 지점 상품 등급별 가격 파싱
- 알라딘 API 응답의 설명만 HTML 엔티티를 한 번 복원해 등록·정보 보강에 사용. 수동 입력·Excel 복원·기존 저장 설명은 원문 유지
- 직접 추가 팝업의 알라딘 검색·책 수동 추가 탭: 알라딘 미리보기 후 새 책 등록 또는 기존 책에 이어 넣기, ISBN 없는 오래된 책·동인지의 수동 등록
- 알라딘 검색 페이지에서 새 책 등록 전 카테고리 선택, 기존 책에 추가할 때는 저장된 분류 유지
- 알라딘 검색과 책 직접 추가에서 기존 책 선택 시 작은 표지 표시. 알라딘 검색 페이지는 선택한 제목을 검색어에 채우고, 기존 결과가 없을 때만 자동 검색
- 책 상세의 알라딘 검색 링크로 진입할 때도 선택한 책 제목으로 검색. 일반 사용자도 검색 화면에서 ISBN 재고 조회로 이동 가능
- 최대 10개 페이지 선택, 서버 재조회 검증, 출간일이 빠른 순서대로 권차 부여 및 항목별 외전 지정. 출간일이 없는 항목은 마지막에 배치하며 같은 날짜의 항목은 기존 검색 순서를 유지
- 책장·보유 권·재고·알라딘 검색의 페이지 이동은 이전·최대 5개 페이지 번호·다음으로 통일하며 검색·정렬 조건 유지
- 모든 검색 화면·기존 책 조회·알라딘 페이지 이동·재고 검색 중 화면 상단의 3px 진행 막대 표시. 겹친 요청이 모두 끝나면 숨기며 직접 추가 창에서도 표시
- 보유 권의 제목·ISBN 검색, 지점 재고의 제목·ISBN·지점 검색 및 페이지 이동
- 별도 워커 기반 중고 재고 일괄 갱신과 SQLite 진행 상태
- 다른 탭에서 시작한 재고 작업도 책 상세에서 10초 간격 및 탭 복귀 시 확인. 계정별 완료 ID로 다른 계정이 전역 작업 행을 재사용한 뒤에도 재고 수·최저가 갱신
- 책 상세의 재고 검색은 해당 책의 구매 필요 권만 대상으로 기존 재고를 유지하며 새 상품을 추가. 중복 상품과 기존 가격은 변경하지 않으며, 기존 재고 관리 권한 적용
- 지점별 재고 집계·상세 화면과 재고 금액 비교 그래프. 그래프의 지점을 누르면 상세 재고로 이동
- 런타임 표지를 `data/covers`에 저장하고 인증된 Route Handler로 제공
- 원격 표지 SSRF 방어, MIME·크기·픽셀 제한, WebP 정규화
- 미생성·유실 표지 재생성
- Excel 백업 내보내기/병합 가져오기와 XLSX 압축 폭탄 제한
- 경로별 고유 항목을 쓰는 표지 ZIP v3 스트리밍 백업, 8MiB 청크·최대 2GiB 업로드, v2/v3 워커 복원. 손상 파일 재복원 및 검증한 임시 파일의 원자적 공개
- 기존 SQLite 조건부 부트스트랩과 최초 전환 전 자동 DB 백업
- 반응형 사이드바/모바일 하단 내비게이션, 키보드 포커스, reduced-motion 대응

## 검증

```bash
npm run verify:source
npm run build
npm run test:e2e
npm run db:verify
```

`db:verify`는 설정된 실제 DB를 대상으로 실행하며 필요한 bootstrap을 수행합니다. 단위·통합·Playwright 검사는 임시 DB·계정만 사용하며, Playwright가 `25648`의 웹과 별도 워커를 시작합니다. 알라딘은 테스트 프로세스에서 fixture 응답을 사용합니다.

```bash
docker build -t bookshelf:3.1.0-local .
npm run test:docker -- bookshelf:3.1.0-local
CLEANUP_DOCKER_IMAGE=bookshelf:3.1.0-local npm run test:cleanup:docker
```

Docker 검사도 별도 임시 컨테이너·볼륨을 사용합니다. `test:cleanup:docker`는 관리자 로그인 세션으로 정리 API를 호출해 완료 상태, 원본 DB·표지 삭제, 이전본·백업 보존과 인증된 표지 접근을 확인합니다. [ca3 변경·검증 기록](docs/CA3_ROOT_LAYOUT.md), [인증·백업·재고 리뷰 수정](docs/CANARY_REVIEW_20261019.md), [기존 기능 대조 기록](docs/FEATURE_PARITY_AUDIT.md), [아키텍처](docs/ARCHITECTURE.md)를 참고하세요.

## 디렉터리

```text
app/          페이지와 Route Handler
components/   UI 컴포넌트
features/     기능별 queries/actions/service/validation/types
db/           Drizzle 스키마와 SQLite bootstrap
worker/       재고 갱신·표지 ZIP 복원
lib/          환경변수·세션 지원·공통 인프라
scripts/      DB·소스·Docker 검증 도구
tests/        단위·통합·브라우저 검사
data/         Git 제외 DB·표지·업로드·백업
public/       배포용 정적 파일
```

Server Component는 `queries.ts`를 직접 호출합니다. 자기 `/api`를 HTTP로 다시 호출하지 않습니다. Route Handler는 polling·파일 전송·원시 청크·JSON 경계에서 사용합니다. Java 시절 Excel·표지 경로·SHA-256 및 BCrypt 비밀번호 호환과 계정별 소유권 검사는 유지합니다.
