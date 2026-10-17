# Bookshelf Next

Spring Boot/Thymeleaf Bookshelf를 **Next.js App Router + React + TypeScript + Tailwind CSS + Drizzle ORM + SQLite**로 재구현한 버전입니다. 웹과 백그라운드 워커는 같은 저장소·같은 패키지를 사용하지만 별도 프로세스로 실행합니다.

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

## 계층 규칙

| 파일 | 역할 |
|---|---|
| `queries.ts` | 소유권 조건을 포함한 읽기 전용 조회와 화면용 결과 반환 |
| `actions.ts` | Server Action 진입점: 인증, 입력 추출·검증, 서비스 호출, 화면 갱신·이동 |
| `service.ts` | 비즈니스 규칙, 변경 작업, 짧은 트랜잭션, 외부 I/O 조율 |
| `validation.ts` | 신뢰할 수 없는 입력의 Zod 검증 |
| `types.ts` | 여러 계층에서 공유하는 타입만 정의. Drizzle 추론 타입은 중복 선언하지 않음 |

Server Component는 `queries.ts`를 직접 호출합니다. 자기 애플리케이션의 `/api`를 다시 HTTP로 호출하지 않습니다. Route Handler는 polling, 파일 전송, 원시 청크 업로드, JSON 응답이 필요한 경계에만 사용합니다.

## 로컬 실행

Node.js 22 이상이 필요합니다. SQLite 네이티브 모듈을 소스에서 빌드하는 환경에는 Python 3·make·g++도 필요하며 Dockerfile은 이를 설치합니다.

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run db:verify
npm run dev
```

다른 터미널에서 워커를 실행합니다.

```bash
npm run worker:dev
```

개발·프로덕션 기본 주소는 모두 `http://localhost:25647`입니다. 같은 포트의 기존 Spring을 종료한 뒤 실행합니다. Spring 프로필의 이전 버튼으로 동시에 띄우는 새 앱은 충돌을 피하려고 `25648`을 사용합니다. `.env`는 웹·워커·DB CLI가 같은 규칙으로 읽습니다. 알라딘 기능은 `.env`의 `ALADIN_TTB_KEY`가 있을 때 동작합니다.

개발 서버를 `book.sfdcinsight.xyz`로 접속할 때의 HMR 요청은 `next.config.ts`의 `allowedDevOrigins`에서 허용합니다. 이 설정을 변경한 뒤에는 개발 서버를 재시작합니다.

Next는 `next/` 안의 환경변수 파일을 읽으며 저장소 루트의 `.env`를 자동으로 가져오지 않습니다. 알라딘 검색 설정은 `next/.env.local`에 아래 값을 저장하고 웹·워커를 모두 재시작합니다. 실제 키는 Git에 올리지 않습니다.

```dotenv
ALADIN_TTB_KEY=발급받은_TTB_키
```

`REGISTRATION=false`가 기본이며 페이지와 Server Action 모두 회원가입을 차단합니다. 비어 있는 신규 DB에서는 최초 실행에만 `REGISTRATION=true npm run dev`로 회원가입을 활성화해 첫 관리자 계정을 만든 뒤, 비활성 설정으로 재시작합니다. 기존 데이터 이전에서는 기존 계정과 비밀번호를 사용합니다.

npm 12에서 `EALLOWREMOTE`가 발생하면 해당 프로젝트의 설치 명령에만 `npm ci --allow-remote=all`을 사용합니다. 네이티브 설치 스크립트는 `package.json`의 이름 기반 `allowScripts` 목록으로 제한합니다.

`BOOKSHELF_COOKIE_SECURE=auto`는 프록시의 `X-Forwarded-Proto`/`Forwarded` 값을 기준으로 Secure 쿠키를 선택합니다. HTTPS 프록시가 관련 헤더를 전달하지 않는 환경에서는 `true`, 내부 HTTP 환경에서는 `false`를 명시하세요.

## 책 등록과 재고 갱신

**책장 → 책 직접 추가**에서 기존 책 검색칸에 제목·저자를 입력하면 표지·제목·저자·분류·다음 권차가 담긴 드롭다운이 표시됩니다. 결과를 클릭하거나 방향키와 Enter로 선택합니다. 검색칸을 비우거나 **새 책으로 등록**을 누르면 새 책을 만듭니다. 새 책은 제목·저자·카테고리·총 권수 메모·설명을 입력하고 **추가 예정 확인**을 누릅니다. 같은 화면의 알라딘 결과에서 등록할 권과 외전을 선택하고 등록합니다. 페이지를 이동해도 선택은 유지하며, 뒤 페이지의 위쪽부터 권차를 붙입니다. 기존 책은 마지막 정규 권차 다음부터 이어 넣고 카테고리를 유지합니다. 이미 등록한 ISBN은 선택할 수 없습니다.

알라딘 결과가 없으면 **책만 추가**할 수 있습니다. 알라딘을 거치지 않으려면 **알라딘 외 등록**을 선택해 표지 파일·URL과 입력 정보로 새 책을 만듭니다. 직접 추가를 접었다 다시 열면 입력과 검색·선택 상태가 초기화됩니다.

**알라딘 검색**에도 같은 표지 드롭다운을 사용합니다. **상세 검색 조건**에서는 작가·출판사·검색 대상·정렬·출간 범위·품절 제외 등을 지정할 수 있고, 페이지 이동과 선택 등록에도 같은 조건이 유지됩니다. 선택한 항목별 외전 지정도 가능합니다. 자동 알라딘 표지 다운로드에 실패하면 책 등록을 유지하고 원본 URL을 남겨 **프로필 → 미생성 표지 재생성**에서 다시 시도합니다.

책 상세의 **저자/설명 넣기**는 빈 정보만 채웁니다. **권 직접 추가**는 다음 정규 권차를 제안하며 **외전·특별판**을 선택할 수 있습니다. **모든 권 선택** 또는 항목별 선택 후 **선택한 권 삭제**로 여러 권을 삭제합니다.

책 상세의 **알라딘에서 권 검색**에서는 화면을 떠나지 않고 검색한 권을 원하는 권번호 또는 외전으로 등록합니다. **보유 권 검색 → 알라딘 상품 검색·한 권씩 등록**에서도 같은 방식으로 등록하며, 기존 책은 표지 드롭다운으로 선택하고 새 책은 카테고리·총 권수 메모를 지정합니다. 저장 후에도 검색 결과가 유지됩니다. **권 정보 수정 → 책 카테고리**는 해당 시리즈 전체의 카테고리를 변경합니다.

**ISBN 재고 조회 → 재고 종류**에서 전체·직배송·지점 중고를 선택하면 건수·최저가와 해당 원본 JSON 응답을 확인할 수 있습니다. 대시보드의 **분류별 현황**은 전체 분류를 권수 또는 전체 도서 금액으로 비교합니다. 보유 권 검색은 ISBN10과 기존 백업의 등록일 정렬도 지원합니다.

Java 엑셀의 `예/아니오`와 외전 표시를 보존하며, 제목을 바꾼 책도 ISBN으로 기존 시리즈에 병합합니다. 같은 제목의 여러 책·권은 각각 유지하고, 여러 시리즈를 한 책으로 잘못 합치는 입력은 전체를 거절합니다.

총 권수 메모는 권 추가·삭제·알라딘 등록 후에도 입력한 값을 유지하며, 실제 등록 권수는 별도로 계산합니다. Excel 백업은 레거시 `seq`와 실제 권번호 `volume`을 각각 내보내고 복원합니다. 예전 백업처럼 두 열 중 하나만 있으면 해당 값을 양쪽에 적용하며, Java 백업 형식도 계속 지원합니다.

**지점 재고 → 갱신 시작**은 관리자 기능입니다. 웹 서버와 함께 `npm run worker`(개발 시 `npm run worker:dev`)를 별도 터미널에서 실행해야 합니다. 워커가 없으면 작업은 `QUEUED` 상태로 대기합니다. 웹·워커가 같은 DB와 `ALADIN_TTB_KEY`를 읽어야 하며, 구매 완료·구매 불필요 권은 갱신 대상에서 제외합니다. 갱신 완료·실패 시 진행 상태와 재고 목록·지점 집계가 자동으로 갱신됩니다.

같은 DB에는 워커 하나만 실행할 수 있습니다. 이 중복 실행 방지가 없는 이전 버전에서 교체할 때는 기존 워커를 모두 종료한 뒤 새 워커를 시작하세요. DB 옆의 `.worker-lock.sqlite` 파일은 실행 중 삭제하지 않습니다. 프로세스가 종료되면 잠금은 자동으로 해제됩니다. 이 잠금은 같은 호스트의 로컬 파일시스템을 전제로 합니다.

## 기존 데이터 사용

기존 Spring 프로필의 **새 책장으로 이전** 버튼으로 DB·표지 복사부터 새 앱 실행까지 자동 처리할 수 있습니다. 최초 패치 설치와 Docker 이전용 패키지는 [원클릭 이전 안내](docs/ONE_CLICK_MIGRATION.md)를 참고하세요. 수동 절차는 아래와 같습니다.

이전 후에는 Next **프로필 → 기존 데이터 정리 → 기존 DB·표지 삭제**를 사용할 수 있습니다. 관리자만 실행할 수 있고, 실제 이전본·이전 전 DB 백업·원본 표지를 검증합니다. 기존 Spring이 원본을 열고 있으면 차단합니다. 새 데이터·수동 백업·로그는 유지합니다. 원본 디렉터리는 `BOOKSHELF_LEGACY_DATA_DIR`로 지정하며 기본값은 `../data`입니다.

정리 상태는 프로필 첫 화면부터 표시됩니다. **원본 삭제 완료**이면 원본 DB·표지가 이미 없어 삭제 버튼이 비활성입니다. Spring 종료 후에는 **상태 다시 확인**을 누르세요. 조회 실패나 15초 이상 지연 시에는 안내 메시지가 표시되며 다시 확인할 수 있습니다.

1. Java 애플리케이션을 완전히 종료합니다.
2. 기존 `bookshelf.sqlite`를 `data/bookshelf.sqlite`로 복사합니다.
3. 기존 표지를 `data/covers/`로 복사합니다.
4. `.env`의 `BOOKSHELF_LEGACY_OWNER_USERNAME`에 기존 공유 데이터를 소유할 계정을 지정합니다.
5. `npm run db:migrate`와 `npm run db:verify`를 실행합니다.

자세한 절차와 롤백 포인트는 [`docs/MIGRATION.md`](docs/MIGRATION.md)를 참고하세요.

현재 저장소의 검증용 복사본은 `data/migration-check/`에 있습니다. 기존 Java와 함께 확인할 때는 복사본만 지정합니다.

```bash
BOOKSHELF_DB_PATH=./data/migration-check/bookshelf.sqlite \
BOOKSHELF_DATA_DIR=./data/migration-check npm run dev
```

워커도 같은 두 환경변수로 실행합니다. 검증용 DB와 표지는 Git에서 제외됩니다.

## Docker 실행

### 3.0.0-ca1 사전 릴리스

`trstyq/bookshelf:3.0.0-ca1`은 Next.js 웹·워커용 `linux/amd64` 이미지입니다. 같은 이미지에서 웹은 `npm run start`, 워커는 `npm run worker`로 실행합니다. Java에서 데이터 이전을 마쳤다면 저장소 **루트**에서 아래 명령으로 발행 이미지를 사용합니다. 루트 `.env`의 알라딘 설정과 기존 `./next/data`를 그대로 사용합니다.

```bash
docker compose -f docker-compose.next.yml -f docker-compose.next.release.yml pull
# 기존 Spring·Next 웹·워커를 종료한 뒤 실행합니다.
docker compose -f docker-compose.next.yml -f docker-compose.next.release.yml up -d --no-build
```

웹·워커 모두 `./next/data:/app/data`를 연결하며 `active-migration.json`의 이전 완료 경로를 따릅니다. 다른 호스트 경로에 데이터를 보관했다면 두 서비스의 마운트를 함께 맞춥니다. Java 원본을 직접 연결하는 업데이트가 아니므로 아직 이전하지 않았다면 먼저 [원클릭 이전 안내](docs/ONE_CLICK_MIGRATION.md)를 진행하세요. 최초 신규 설치에서는 아래 로컬 빌드 절차를 사용합니다.

### 로컬 빌드

`next/`에서 실행합니다.

```bash
cp .env.example .env
docker compose up -d --build
```

`web`과 `worker`는 같은 이미지와 `bookshelf-data:/app/data` 볼륨을 사용합니다. 기존 호스트 데이터를 직접 마운트하려면 두 서비스의 volume을 모두 다음처럼 바꿉니다.

```yaml
volumes:
  - ./data:/app/data
```

호스트의 `data/`는 컨테이너 UID/GID `1001:1001`이 읽고 쓸 수 있어야 합니다.

## 검증

Java와 기능별로 대조한 결함·수정·검증 범위는 [기능 대조 점검표](docs/FEATURE_PARITY_AUDIT.md)에 기록했습니다. Excel 가져오기는 Next의 Books/Volumes와 Java의 안내/도서/권 형식을 지원합니다.

```bash
npm run check:syntax
npm run check:structure
npm run typecheck
npm test
npm run build
npm run db:verify
```

Playwright는 임시 DB·테스트 계정·별도 웹과 워커를 자동 생성하며 테스트 포트 `25648`을 사용합니다. 해당 포트에서 이전용 새 앱을 실행 중이라면 종료한 뒤 검사합니다. 알라딘은 테스트 프로세스에서만 목업을 사용합니다.

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

Docker를 직접 검증하려면 `docker build -t bookshelf-next:migration-local .` 후 `npm run test:docker`를 실행합니다. 전용 임시 볼륨과 컨테이너를 사용하고 종료 시 정리합니다.

이미지 처리·CSS·테스트 의존성의 보안 수정 버전을 사용합니다. `exceljs`의 UUID와 Drizzle 도구의 esbuild는 수정 버전으로 override하며, 실제 엑셀 왕복과 DB CLI 검증을 함께 수행합니다.

## 디렉터리

```text
app/          URL, 페이지, Route Handler
components/   UI 컴포넌트
features/     기능별 queries/actions/service/validation/types
db/           Drizzle schema, SQLite bootstrap, migration baseline
worker/       별도 백그라운드 프로세스
lib/          환경변수, 오류, 로깅 등 공통 서버 인프라
data/         Git 제외 런타임 DB·표지·업로드·백업
public/       배포 시 포함되는 정적 파일만 저장
tests/        Vitest 단위 테스트와 Playwright E2E
```
