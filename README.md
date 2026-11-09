# Bookshelf

도서·권 관리, 알라딘 검색·등록, 직배송·우주점 중고 재고 조회를 제공하는 책장입니다. Next.js·React·TypeScript·Drizzle·SQLite를 사용합니다.

**4.1.0 출시 준비** · [변경 내용](docs/RELEASE_4.1.0.md) · [현재 정식 버전 4.0.1](https://github.com/ts2580/library/releases/tag/v4.0.1)

4.0.0부터 종료된 알라딘 OpenAPI 대신 공개 페이지를 사용합니다. 4.1.0은 책장의 일반 책 검색과 개별 권 상세 검색을 분리하고 직접 추가 폼 문구를 정리합니다. API 키는 필요하지 않습니다.

## 주요 기능

- 계정별 도서·권 관리, 카테고리, 표지 업로드, 구매 여부 및 외전 관리
- 책장 일반 검색과 개별 권 상세 검색, ISBN 없는 권의 제목·저자 검색
- 알라딘 검색과 여러 페이지 선택 등록, 기존 책에 권 추가, 빈 저자·설명·구매 링크 보강
- 소장 도서 선택 차단, 직접 체크 순서 또는 출간일·제목 숫자 순서에 따른 권차 부여
- 워커 기반 직배송·우주점 중고 재고 갱신, 책별 추가 검색, 지점별 가격 비교
- 재고 작업 이력·실패 원인·재시도·취소, 조회 실패 시 기존 재고 보존
- Excel 및 표지 ZIP 백업·복원, 기존 Java 데이터 이전, PC·모바일 화면

## 로컬 실행

Node.js 22 이상이 필요합니다. 기존 설정이 없다면 `.env.example`을 `.env`로 복사합니다. SQLite 네이티브 모듈을 직접 빌드하는 환경에는 Python 3·make·g++도 필요합니다.

```bash
npm ci
npm run dev:all
```

`http://localhost:25647`에서 접속합니다. 웹·워커가 함께 실행되며 코드 변경을 감지합니다. `Ctrl+C`로 함께 종료하고, 포트는 `PORT=25649 npm run dev:all`처럼 바꿉니다. 개별 실행은 `npm run dev`와 `npm run worker:dev`입니다.

신규 설치는 `.env`에 `REGISTRATION=true`를 설정하고 `/signup`에서 첫 관리자 계정을 만든 뒤 `false`로 되돌립니다. 기존 설치는 원래 계정과 설정을 사용합니다. 예전 `next/` 디렉터리에서 실행하던 설치는 [데이터 이동 절차](docs/ONE_CLICK_MIGRATION.md#이전-완료한-로컬-실행)를 먼저 따릅니다.

프로덕션 실행은 빌드 후 웹·워커를 각각 시작합니다.

```bash
npm run build
npm run start
# 다른 터미널에서
npm run worker
```

웹·워커·DB CLI는 루트 `.env`와 동일한 데이터 경로를 사용합니다. 운영 HTTPS 프록시는 `X-Forwarded-Proto`를 전달하며, 필요하면 `BOOKSHELF_COOKIE_SECURE=true` 또는 내부 HTTP의 `false`를 지정합니다. 개발 프록시는 `next.config.ts`의 `allowedDevOrigins`와 WebSocket 전달 설정을 맞춥니다. Nginx Proxy Manager에서는 `Websockets Support`를 켭니다.

## Docker

직접 빌드하는 신규 설치는 다음과 같습니다.

```bash
docker compose up -d --build
```

기존 `Bookshelf-next`·`Bookshelf` 볼륨을 사용하는 설치는 [발행용 Compose](docker-compose.release.yml)를 사용합니다. 이 브랜치의 기본 이미지는 `trstyq/bookshelf:4.1.0`입니다. 4.1.0 Release와 이미지 발행을 확인한 뒤 업데이트하세요. 현재 정식 이미지는 `trstyq/bookshelf:4.0.1`입니다. 다른 버전을 선택하려면 `.env`의 `BOOKSHELF_IMAGE`를 지정합니다.

업데이트 전 DB·표지를 백업하고 기존 `.env`와 실제 볼륨 이름을 확인합니다. 기존 웹·워커를 종료한 뒤 같은 버전으로 함께 교체합니다.

```bash
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

- 새 데이터 볼륨은 `BOOKSHELF_DATA_VOLUME` → 기존 `BOOKSHELF_NEXT_VOLUME` → `Bookshelf-next` 순서로 선택합니다. Java 원본 볼륨은 `BOOKSHELF_LEGACY_VOLUME`이며 기본값은 `Bookshelf`입니다.
- 웹·워커는 같은 로컬 `/data` 볼륨을 공유하며 UID/GID `1001:1001`로 실행합니다. 웹의 Java 원본 경로는 `/data/legacy`입니다. 기존 데이터 대신 새 빈 볼륨을 만들지 않습니다.
- 일회성 `permissions` 서비스만 root로 실행해 기존 볼륨의 소유권을 맞춥니다. 심볼릭 링크 대상은 따라가지 않습니다.
- 컨테이너 웹 포트는 `25647`, 호스트 포트는 `SERVER_PORT`로 지정합니다. 이미지나 볼륨 설정을 바꾼 뒤에는 컨테이너를 재생성합니다.

Java에서 아직 이전하지 않았다면 [ca2 이전용 이미지와 안내](https://github.com/ts2580/library/releases/tag/v3.0.0-ca2)를 먼저 사용합니다. 현재 앱은 Java·Gradle·이전용 실행기를 포함하지 않습니다. 기존 설치의 상세 경로·원본 정리·호환 안내는 [이전·전환 문서](docs/ONE_CLICK_MIGRATION.md)에 있습니다.

## 알라딘 운영

4.0.0부터 알라딘 공개 검색·상품 상세·전체 중고 목록의 HTML을 읽습니다. 기존 `ALADIN_TTB_KEY`는 사용하지 않으며 `ALADIN_MIN_REQUEST_INTERVAL_MS` 대신 다음 설정을 사용합니다.

```dotenv
ALADIN_PAGE_INTERVAL_MS=1000
ALADIN_MAX_ATTEMPTS=3
ALADIN_INITIAL_BACKOFF_MS=2000
ALADIN_MAX_BACKOFF_MS=30000
```

재고 갱신은 최대 10권 병렬이며 웹·워커 합산 HTTP 요청도 최대 10건입니다. 요청 시작 간격은 기본 1초이고 429 대기를 공유합니다. DB당 워커는 하나만 실행하고, 웹·워커가 같은 호스트의 로컬 데이터 경로를 공유해야 합니다. 실행 중 `.worker-lock.sqlite`, `aladin-requests.sqlite`, `.slot-0`~`.slot-9` 파일을 삭제하지 않습니다.

전체 중고 목록에서 **알라딘 직배송·이 광활한 우주점**의 온라인 판매 상품만 수집합니다. 개인·전문 판매자, 방문 구매 전용 재고·매장 실물 부수는 포함하지 않습니다. 구조 변경·접근 거절·타임아웃·부분 조회 실패 시 기존 재고를 유지하고, 정상적인 0건 확인 시 전체·선택 갱신의 해당 권 재고만 비웁니다. 책 상세의 추가 검색은 기존 재고·가격을 유지하며 새 상품만 더합니다.

**재고 → 갱신 로그 → 작업 기록**에서 권수·시작/종료시간(KST)·작업시간을 확인하고, **미해결 실패**에서 실패 원인·직접 검색·재시도를 사용할 수 있습니다. 직접 검색은 저장 재고를 바꾸지 않으며 갱신 성공 시 실패가 해제됩니다.

검색 결과는 5분, 상품 상세는 24시간 동안 프로세스별로 캐시하고 재고 목록은 매번 새로 읽습니다. 4.0.1에서 ISBN이 없는 검색 결과는 소장 여부를 확인하기 위해 필요한 상품 상세를 조회하므로 첫 검색 시간이 늘 수 있습니다. 지원 옵션과 외부 페이지의 한계는 [4.0.0 변경 내용](docs/RELEASE_4.0.0.md)을 참고하세요.

## 데이터와 검증

로컬 데이터 루트는 `data/`, Docker 내부는 `/data`입니다. DB·표지·업로드·백업·`active-migration.json`을 함께 유지합니다. 이전 기록이 있으면 같은 루트의 `migrations/handover-*`를 사용합니다. 4.0.0의 DB 스키마는 7이며 4.1.0에서도 추가 변경은 없습니다.

```bash
npm run verify:source
npm run build
npm run test:e2e
BOOKSHELF_E2E_SIGNUP=true npm run test:e2e
npm run db:verify
```

단위·통합·Playwright 검사는 임시 DB·계정과 알라딘 HTML fixture를 사용합니다. Playwright는 `25648` 웹과 별도 워커를 시작합니다. `db:verify`는 설정된 실제 DB를 대상으로 bootstrap과 무결성 검사를 수행합니다.

```bash
docker build -t bookshelf:4.1.0-local .
npm run test:docker -- bookshelf:4.1.0-local
CLEANUP_DOCKER_IMAGE=bookshelf:4.1.0-local npm run test:cleanup:docker
```

Docker 검사는 격리된 컨테이너·볼륨을 사용합니다. 관리자 원본 정리 API, 데이터·백업 보존과 인증된 표지 접근도 검증합니다.

[아키텍처](docs/ARCHITECTURE.md) · [기존 기능 대조](docs/FEATURE_PARITY_AUDIT.md) · [4.0.0 전환 기록](docs/WORKLOG_4.0.0.md)

애플리케이션은 `app/`·`components/`·`features/`·`db/`·`lib/`·`worker/`, 검증 도구는 `scripts/`·`tests/`에 있습니다. Server Component는 queries를 직접 호출하며 Route Handler는 브라우저 HTTP 요청과 파일 전송을 처리합니다. 기존 BCrypt·레거시 SHA-256 로그인 및 Excel·표지 ZIP 호환은 유지합니다.
