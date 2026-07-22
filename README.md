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

## 소유권·재고 참조 마이그레이션 정리

임시 소유권 마이그레이션 경로는 제거되었고, 현재 운영/개발 DB는 `owner_id`, `book_volume_id` 정합성 전제하에 동작합니다.
새로운 화면/스크립트에는 `/user/profile/migrations/*` 경로가 더 이상 없습니다.

## 엑셀 백업과 커버 재생성

사용자 프로필에서 현재 로그인 계정의 도서·권 데이터를 `.xlsx`로 내려받거나 다시 업로드할 수 있습니다. 업로드는 엑셀 안의 사용자 정보가 아니라 현재 세션의 회원 ID를 소유자로 사용하며, ISBN13이 일치하는 기존 도서·권을 우선 upsert합니다. 일치 ISBN13이 없으면 제목·저자를 보조 기준으로 사용하고 기존 데이터를 자동 삭제하지 않습니다.

엑셀에는 이미지 파일이 포함되지 않으므로 업로드된 도서와 권은 `cover_generated = false`로 기록됩니다. 프로필의 `커버 재생성`은 현재 계정의 미생성 항목만 처리하고, 로컬 커버 파일 확인 또는 새 다운로드에 성공한 항목만 `true`로 전환합니다. 실패 항목은 `false`로 남아 다음 실행에서 다시 처리됩니다. 커버 검색과 다운로드에는 `ALADIN_TTB_KEY`가 필요합니다.

표지 파일은 프로필의 `표지 압축 다운로드`에서 별도 ZIP으로 백업할 수 있습니다. 브라우저는 ZIP을 8MiB 청크로 순차 전송하며 최대 2GiB까지 업로드할 수 있고, 서버는 재조립 후 백그라운드에서 복원 상태를 처리합니다. ZIP 복원은 현재 계정의 데이터가 참조하는 안전한 이미지 파일만 커버 저장소에 풀며, 이미 존재하는 파일은 덮어쓰지 않습니다. 복원되었거나 이미 존재함이 확인된 표지는 `cover_generated = true`로 갱신됩니다. 따라서 전체 복원은 엑셀을 먼저 업로드한 뒤 표지 ZIP을 업로드하는 순서가 권장됩니다.

책 수동 추가에서 `알라딘 외 등록`을 선택하면 알라딘 조회 없이 입력한 제목·저자·설명·표지 URL 등의 정보로 새 책을 등록합니다. 이때 JPG·PNG·GIF 표지 파일(최대 8MB)을 직접 올릴 수 있으며, 파일을 선택하면 표지 URL보다 우선합니다. 도서 상세의 `권 추가`에서도 같은 직접 등록 방식과 표지 파일 업로드를 사용할 수 있고, 책 정보 수정에서도 표지 파일을 교체할 수 있습니다.

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
