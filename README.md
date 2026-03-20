# bookshelf

책장/재고 조회용 Spring Boot 프로젝트 📚
기존 세일즈포스에 있던 코드를 Java로 이관.
세일즈포스 떼어냄.

## 실행

```bash
cp .env.example .env
# 환경값 수정 후
export $(grep -v '^#' .env | xargs)
./gradlew bootRun
```

```bash
SERVER_PORT=25647 \
BOOKSHELF_DB_URL='jdbc:mariadb://localhost:3306/bookshelf?characterEncoding=UTF-8' \
BOOKSHELF_DB_USERNAME=bookshelf \
BOOKSHELF_DB_PASSWORD=CHANGE_ME \
./gradlew bootRun
```

루트에서 바로 실행하고 싶으면 `run.sh` 사용.

```bash
./run.sh            # .env 자동 로드 + 포트 충돌 자동 정리 + foreground 실행
./run.sh --dev      # .env 자동 로드 + compileJava 검증 + 포트 충돌 자동 정리 + foreground 실행
```

`run.sh`는 같은 포트(기본 `25647`)에서 동작 중인 프로세스가 있으면 자동으로 종료 후 앱을 실행.

## 기본 포트
- http://localhost:25647

## 현재 구조
- `src/main/java/com/example/bookshelf/BookshelfApplication.java`
- `src/main/java/com/example/bookshelf/web/*Controller.java`
- `src/main/java/com/example/bookshelf/user/repository/*`
- `src/main/java/com/example/bookshelf/integration/aladin/*`
- `src/main/resources/application.yml`

