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
BOOKSHELF_DB_URL='jdbc:mariadb://localhost:3306/bookshelf?characterEncoding=UTF-8' \
BOOKSHELF_DB_USERNAME=bookshelf \
BOOKSHELF_DB_PASSWORD=CHANGE_ME \
./gradlew bootRun
```

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
