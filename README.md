# bookshelf

책장/재고 조회용 Spring Boot 프로젝트예요 📚

## 실행

```bash
cp .env.example .env
# 환경값 수정 후
export $(grep -v '^#' .env | xargs)
./gradlew bootRun
```

또는 필요한 서버 포트만 직접 넘겨도 돼요.

```bash
SERVER_PORT=25647 \
./gradlew bootRun
```

기본값은 SQLite입니다. DB URL 환경변수를 주입하지 않아도 루트의 `data/bookshelf.sqlite` 파일을 사용하고, 시작 시 `src/main/resources/schema.sql`로 필요한 테이블을 생성합니다.

알라딘 API 연동은 `ALADIN_TTB_KEY`가 있을 때만 동작합니다. 외부 조회 실패와 정상적인 재고 없음은 분리해서 처리하며, 조회 실패 시 기존 지점 재고를 삭제하지 않습니다.

```bash
ALADIN_TTB_KEY=your-key ./gradlew bootRun
```

운영 환경에서는 remember-me 서명 키도 고정된 랜덤 문자열로 주입하세요.

```bash
APP_REMEMBER_ME_KEY="$(openssl rand -hex 32)" \
ALADIN_TTB_KEY=your-key \
./gradlew bootRun
```

`prod` 프로필에서는 32자 미만이거나 알려진 기본 remember-me 키를 허용하지 않으므로, `APP_REMEMBER_ME_KEY`에 안정적인 임의 값을 주입하지 않으면 애플리케이션이 기동하지 않습니다. `docker-compose.example.yml`도 이 키를 필수로 요구합니다.

## 임시 소유권·재고 참조 마이그레이션

기존 로컬 DB와 배포 서버 DB는 서로 별도이므로 각각 마이그레이션해야 합니다. 마이그레이션은 기존 책을 각 DB의 `trstyq` 회원에게 할당하고, 지점 재고를 안정적인 `book_volume_id`로 연결하며, 다중 사용자 소유를 막는 전역 ISBN 유일 인덱스를 제거합니다.

앱을 중지할 수 있는 환경에서는 임시 CLI 스크립트를 사용합니다. 스크립트는 원본 DB 옆에 타임스탬프 백업을 먼저 생성합니다.

```bash
./run-bg.sh stop
./scripts/migrate_book_ownership.sh ./data/bookshelf.sqlite
```

컨테이너처럼 DB 파일에 직접 접근하기 어려운 환경에서는 새 버전을 배포한 뒤 `trstyq`로 로그인하고 `/user/profile`의 `소유권 마이그레이션 실행` 버튼을 사용합니다. 버튼과 서버 엔드포인트는 `trstyq` 관리자에게만 허용되고 여러 번 실행해도 이미 연결된 데이터는 변경하지 않습니다.

각 DB에서 완료 후 다음 조건을 확인합니다.

```sql
SELECT COUNT(*) FROM books WHERE owner_id IS NULL;
SELECT COUNT(*) FROM branchbook WHERE book_volume_id IS NULL;
SELECT COUNT(*) FROM pragma_foreign_key_check;
```

세 결과가 모두 `0`이고 로컬·배포 서버 양쪽에서 완료된 것을 확인한 뒤에만 다음 릴리스에서 프로필 버튼, `/user/profile/migrations/book-ownership` 엔드포인트, `scripts/migrate_book_ownership.sh`를 제거합니다. 그 최종 릴리스에서 `books.owner_id`의 필수 제약을 확정합니다.

애플리케이션을 SQLite DB로 실행한 뒤 주요 화면 smoke test를 돌릴 수 있습니다.

```bash
BOOKSHELF_BASE_URL=http://localhost:25647 \
BOOKSHELF_DB_PATH=./data/bookshelf.sqlite \
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

앱 실행용 `.env`에는 SQLite URL을 넣지 않습니다. 애플리케이션은 루트 `data/bookshelf.sqlite`를 자동으로 사용합니다.

루트에서 바로 실행하고 싶으면 `run.sh`를 써요.

```bash
./run.sh                    # .env 자동 로드 + Tailwind 빌드 + 포트 충돌 자동 정리 + foreground 실행
./run.sh --dev              # .env 자동 로드 + Tailwind 빌드 + compileJava 검증 + 포트 충돌 자동 정리 + foreground 실행
./run.sh --skip-css         # .env 자동 로드 + Tailwind 빌드 생략 + 포트 충돌 자동 정리 + foreground 실행
./run.sh --dev --skip-css   # .env 자동 로드 + Tailwind 빌드 생략 + compileJava 검증 + 포트 충돌 자동 정리 + foreground 실행
```

`run.sh`는 같은 포트(기본 `25647`)에서 동작 중인 프로세스가 있으면 자동으로 종료 후 앱을 실행합니다.

백그라운드 제어가 필요하면 `run-bg.sh`를 사용하세요.

```bash
./run-bg.sh start --dev            # 백그라운드 시작
./run-bg.sh status                  # 상태 확인
./run-bg.sh stop                    # 백그라운드 종료
./run-bg.sh restart --skip-css       # 재시작
./run-bg.sh logs                    # 최근 로그 확인
```

## 기본 포트
- http://localhost:25647

## 현재 구조
- `src/main/java/com/example/bookshelf/BookshelfApplication.java`
- `src/main/java/com/example/bookshelf/web/*Controller.java`
- `src/main/java/com/example/bookshelf/user/repository/*`
- `src/main/java/com/example/bookshelf/integration/aladin/*`
- `src/main/resources/application.yml`

## 개선 메모
- SQLite DB는 루트 `data/bookshelf.sqlite`를 기본 경로로 사용
- 로그인 세션 조회 로직은 공통 헬퍼로 관리
- 외부 API(알라딘) 연동 실패는 로그 남기고 화면은 최대한 정상 동작 유지

## 빌드/실행 보완
- `./run.sh` 기본 동작은 vendor JS 복사와 Tailwind CSS 빌드를 먼저 수행합니다. `node_modules`가 없고 `package-lock.json`이 있으면 `npm ci --no-audit --no-fund`를 사용하고, lockfile이 없을 때만 `npm install --no-audit --no-fund`로 설치합니다. `--skip-css` 옵션 시 빌드를 완전히 건너뜁니다.
- Docker 이미지는 빌드 단계에서 Tailwind CSS를 생성한 뒤 JAR을 빌드합니다.
  ```bash
  docker build -t bookshelf:2.0.0 .
  docker run --rm -p 25647:25647 -v "$PWD/data:/data" bookshelf:2.0.0
  ```
