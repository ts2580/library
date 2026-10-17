# Bookshelf

Next.js App Router + React + TypeScript + Drizzle + SQLite로 구성한 책장입니다. **3.0.0-ca3부터 프로젝트 루트에서 실행**합니다. 웹과 재고·표지 ZIP 처리 워커는 같은 패키지와 DB를 사용하는 별도 프로세스입니다.

## 로컬 실행

Node.js 22 이상이 필요합니다. 기존 설정이 없다면 `.env.example`을 `.env`로 복사하고 `ALADIN_TTB_KEY`를 설정합니다. SQLite 네이티브 모듈을 직접 빌드하는 환경에는 Python 3·make·g++도 필요합니다.

기존 `next/`에서 실행 중인 웹·워커는 종료한 뒤 루트에서 다시 실행합니다.

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

## 기존 ca2 데이터로 전환

소스 위치만 바뀌며 DB 스키마와 Docker 데이터 위치는 유지합니다.

| 환경 | 새 앱 데이터 | 원본 정리용 Java 데이터 |
|---|---|---|
| Docker | 웹·워커 모두 `Bookshelf-next:/app/data` | 웹에 `Bookshelf:/data` |
| 로컬 원클릭 이전 | `data/active-migration.json`, 없으면 기존 `next/data/active-migration.json` | `BOOKSHELF_LEGACY_DATA_DIR`로 지정 |

**Next 전용 이미지에 `/app/next/data`를 연결하면 이전 DB를 읽지 못합니다.** 항상 `/app/data`에 연결합니다. 새 빈 볼륨을 만들거나 이전 기록 파일만 따로 옮기지 않습니다. 실제 DB·표지·백업과 `active-migration.json`을 함께 유지합니다.

로컬 `next/data` 이전본은 그대로 두어도 루트 실행 시 인식합니다. 기존 `next/.env`의 설정은 루트 `.env`로 옮기되 사용자 지정 상대 경로를 확인합니다. 기본 DB·데이터 경로는 `.env.example`처럼 `./data/bookshelf.sqlite`·`./data`를 사용해야 이전 기록을 자동 선택합니다. 원본이 루트 `data/`에 남아 있다면 `BOOKSHELF_LEGACY_DATA_DIR=./data`로 지정합니다. 원클릭 이전 기록 없이 직접 운영하던 `next/data`는 `BOOKSHELF_DB_PATH=./next/data/bookshelf.sqlite`, `BOOKSHELF_DATA_DIR=./next/data`를 명시합니다.

Java 소스·Gradle·이전용 실행기는 ca3에서 제거했습니다. 아직 Java 데이터 이전 전이면 [ca2 이전용 이미지와 안내](https://github.com/ts2580/library/releases/tag/v3.0.0-ca2)를 먼저 사용합니다. [이전·전환 절차](docs/ONE_CLICK_MIGRATION.md)에 기존 DB·표지 정리까지 설명했습니다.

## Docker

### 신규 설치·로컬 빌드

루트 `.env`를 준비한 뒤 실행합니다. 이 구성은 새 설치용 `bookshelf-data` 볼륨을 사용합니다.

```bash
docker compose up -d --build
```

컨테이너 내부 웹 포트는 항상 `25647`이며, 호스트 포트는 `SERVER_PORT`로 바꿉니다. 웹·워커는 같은 `/app/data` 볼륨을 공유하고 UID/GID `1001:1001`로 실행합니다.

### 기존 Bookshelf-next 볼륨 사용

`docker-compose.release.yml`은 기존 `Bookshelf-next`와 `Bookshelf`를 external volume으로 연결합니다. 실제 이름이 다르면 `.env`의 `BOOKSHELF_DATA_VOLUME`·`BOOKSHELF_LEGACY_VOLUME`을 맞춥니다. 기존 Java·Next 웹·워커를 모두 종료한 뒤 이 구성으로 전환합니다.

새 데이터 볼륨은 `BOOKSHELF_DATA_VOLUME` → ca2의 `BOOKSHELF_NEXT_VOLUME` → `Bookshelf-next` 순서로 비어 있지 않은 값을 사용합니다. ca2에서 `BOOKSHELF_NEXT_VOLUME`만 지정한 설정도 그대로 사용할 수 있습니다.

ca3은 PR 준비 버전이며 Docker Hub 발행은 별도입니다. 발행 전에는 루트에서 검증 이미지를 빌드해 사용합니다.

```bash
docker build -t bookshelf:3.0.0-ca3-local .
BOOKSHELF_IMAGE=bookshelf:3.0.0-ca3-local docker compose -f docker-compose.release.yml up -d
```

`trstyq/bookshelf:3.0.0-ca3` 발행 후에는 같은 파일에서 기본 이미지로 `pull`·`up -d`를 실행할 수 있습니다. `restart`만으로는 이미지·볼륨 설정 변경이 적용되지 않습니다. 저장소 이름 변경으로 기존 `next_bookshelf-data` 등을 사용하던 경우에도 실제 볼륨 이름을 지정합니다.

워커는 DB당 하나만 실행합니다. 실행 중 `.worker-lock.sqlite`를 삭제하지 않습니다. SQLite와 워커 잠금은 같은 호스트의 로컬 파일시스템을 사용합니다.

## 구현 범위

- 계정별 도서·권 CRUD와 SQL 수준 `owner_id` 소유권 검사
- 기존 BCrypt 및 레거시 SHA-256 로그인 호환, 로그인 성공 시 BCrypt 승격
- SQLite 기반 서버 세션, 전체 세션 폐기형 비밀번호 변경
- 알라딘 도서 검색·등록, ISBN 중고 재고 조회, 지점 상품 등급별 가격 파싱
- 직접 추가 안에서 기존 책 검색·알라딘 미리보기·새 책 등록 또는 기존 책에 이어 넣기
- 최대 10개 페이지 선택, 서버 재조회 검증, 뒤 페이지부터 화면 순서대로 일괄 권 등록 및 항목별 외전 지정
- 모든 검색 화면과 기존 책 검색·알라딘 페이지 이동의 요청 중 스피너
- 보유 권의 제목·ISBN 검색, 지점 재고의 제목·ISBN·지점 검색 및 페이지 이동
- 별도 워커 기반 중고 재고 일괄 갱신과 SQLite 진행 상태
- 지점별 재고 집계·상세 화면
- 런타임 표지를 `data/covers`에 저장하고 인증된 Route Handler로 제공
- 원격 표지 SSRF 방어, MIME·크기·픽셀 제한, WebP 정규화
- 미생성·유실 표지 재생성
- Excel 백업 내보내기/병합 가져오기와 XLSX 압축 폭탄 제한
- 표지 ZIP 스트리밍 백업, 8MiB 청크·최대 2GiB 업로드, 워커 복원
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
docker build -t bookshelf:3.0.0-ca3-local .
npm run test:docker -- bookshelf:3.0.0-ca3-local
CLEANUP_DOCKER_IMAGE=bookshelf:3.0.0-ca3-local npm run test:cleanup:docker
```

Docker 검사도 별도 임시 컨테이너·볼륨을 사용합니다. [ca3 변경·검증 기록](docs/CA3_ROOT_LAYOUT.md), [기존 기능 대조 기록](docs/FEATURE_PARITY_AUDIT.md), [아키텍처](docs/ARCHITECTURE.md)를 참고하세요.

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
