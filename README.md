# bookshelf

책장/재고 조회용 Spring Boot 프로젝트예요 📚

## 실행

```bash
cp .env.example .env
# 환경값 수정 후
export $(grep -v '^#' .env | xargs)
./gradlew bootRun
```

또는 필요한 값만 직접 넘겨도 돼요.

```bash
SERVER_PORT=25647 \
BOOKSHELF_DB_URL='jdbc:sqlite:./bookshelf.sqlite?foreign_keys=on&busy_timeout=5000' \
./gradlew bootRun
```

기본값도 SQLite입니다. 별도 환경변수를 주지 않으면 루트의 `bookshelf.sqlite` 파일을 사용하고, 시작 시 `src/main/resources/schema.sql`로 필요한 테이블을 생성합니다.

## MariaDB에서 SQLite로 이관

기존 `.env`가 MariaDB `BOOKSHELF_DB_URL`을 가리키는 상태라면 그대로 실행할 수 있습니다.

```bash
node migrate_maria_to_sqlite.js ./bookshelf.sqlite
npm run db:verify:migrated -- ./bookshelf.sqlite
```

애플리케이션을 SQLite DB로 실행한 뒤 주요 화면 smoke test를 돌릴 수 있습니다.

```bash
BOOKSHELF_BASE_URL=http://localhost:25647 \
BOOKSHELF_DB_PATH=./bookshelf.sqlite \
npm run screen:smoke
```

이 스크립트는 SQLite DB에 smoke test 계정과 샘플 책/지점 재고를 임시로 추가한 뒤 로그인, 대시보드, 책장, 책 상세, 상품 검색, 지점 재고 화면을 확인하고 fixture를 정리합니다.

SQLite 스키마와 핵심 저장소 SQL만 먼저 확인하려면 아래 검증을 실행합니다.

```bash
npm run db:verify:sqlite
```

현재 환경에서 가능한 로컬 검증을 한 번에 실행하려면 아래 명령을 사용합니다.

```bash
npm run verify:local
```

앱 실행용 `.env`는 이관 후 SQLite URL로 바꿉니다.

```bash
BOOKSHELF_DB_URL=jdbc:sqlite:./bookshelf.sqlite?foreign_keys=on\&busy_timeout=5000
APP_DB_ENABLED=true
```

이미 `.env`를 SQLite로 바꾼 뒤라면 원본 MariaDB 정보는 `MARIA_DB_URL`, `MARIA_DB_USERNAME`, `MARIA_DB_PASSWORD`로 넘기면 됩니다.

루트에서 바로 실행하고 싶으면 `run.sh`를 써요.

```bash
./run.sh                    # .env 자동 로드 + Tailwind 빌드 + 포트 충돌 자동 정리 + foreground 실행
./run.sh --dev              # .env 자동 로드 + Tailwind 빌드 + compileJava 검증 + 포트 충돌 자동 정리 + foreground 실행
./run.sh --skip-css         # .env 자동 로드 + Tailwind 빌드 생략 + 포트 충돌 자동 정리 + foreground 실행
./run.sh --dev --skip-css   # .env 자동 로드 + Tailwind 빌드 생략 + compileJava 검증 + 포트 충돌 자동 정리 + foreground 실행
```

`run.sh`는 같은 포트(기본 `25647`)에서 동작 중인 프로세스가 있으면 자동으로 종료 후 앱을 실행합니다.

## 기본 포트
- http://localhost:25647

## 현재 구조
- `src/main/java/com/example/bookshelf/BookshelfApplication.java`
- `src/main/java/com/example/bookshelf/web/*Controller.java`
- `src/main/java/com/example/bookshelf/user/repository/*`
- `src/main/java/com/example/bookshelf/integration/aladin/*`
- `src/main/resources/application.yml`

## 개선 메모
- DB 접속정보는 코드에 하드코딩하지 말고 환경변수로 주입
- 로그인 세션 조회 로직은 공통 헬퍼로 관리
- 외부 API(알라딘) 연동 실패는 로그 남기고 화면은 최대한 정상 동작 유지

## 빌드/실행 보완
- `./run.sh` 기본 동작은 Tailwind CSS 빌드를 먼저 수행합니다 (`npm install --no-audit --no-fund`(처음 1회) 후 `npm run css:build`). 이미 node_modules가 이미 있는 경우에는 재설치 없이 바로 빌드만 수행합니다. `--skip-css` 옵션 시 빌드를 완전히 건너뜁니다.
- Docker 이미지는 빌드 단계에서 Tailwind CSS를 생성한 뒤 JAR을 빌드합니다.
  ```bash
  docker build -t bookshelf .
  ```
