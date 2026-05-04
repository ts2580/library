# SQLite 전환 보고서

## 목표

Bookshelf 프로젝트의 저장소를 MariaDB에서 SQLite로 전환한다. 완료 기준은 다음과 같다.

- 애플리케이션 기본 저장소가 MariaDB가 아니라 SQLite를 사용한다.
- 런타임 SQL이 SQLite 문법으로 동작한다.
- 기존 MariaDB 데이터를 SQLite DB 파일로 이관한다.
- 이관된 SQLite DB로 애플리케이션을 실행하고 주요 화면 동작을 검증한다.

## 현재 상태

- `build.gradle`의 JDBC 드라이버를 `org.xerial:sqlite-jdbc`로 교체했다.
- `src/main/resources/application.yml`의 기본 datasource를 `jdbc:sqlite:./bookshelf.sqlite`로 변경했다.
- `src/main/resources/schema.sql`에 SQLite용 테이블과 인덱스, FK 스키마를 추가했다.
- Repository SQL에서 MySQL/MariaDB 전용 문법인 `MATCH AGAINST`, `NOW()`, `TRUNCATE`, `REGEXP`, `UNSIGNED`, `ON DUPLICATE KEY UPDATE`를 제거했다.
- Flyway/Liquibase가 없는 프로젝트 구조에 맞춰 기존 MariaDB 지향 `src/main/resources/db/migration` SQL 파일을 제거하고, Spring SQL init의 `schema.sql`로 초기화하도록 바꿨다.
- 기존 PostgreSQL-to-MariaDB 유틸리티 스크립트를 제거했고, Node 의존성은 MariaDB-to-SQLite 마이그레이션에 필요한 `mysql2`만 남겼다.
- `migrate_maria_to_sqlite.js`를 추가했다. 이 스크립트는 `.env` 또는 환경변수의 MariaDB 접속정보를 읽고, SQLite 스키마 생성 후 알려진 애플리케이션 테이블을 배치로 이관하며, FK 위반을 사전/사후 검사한다.
- `run.sh`는 로컬 `.env`가 아직 MariaDB `BOOKSHELF_DB_URL`을 가리키면 경고를 출력한다.
- 로컬 `.env`는 런타임 `BOOKSHELF_DB_URL`을 SQLite로 바꾸고, 기존 MariaDB 원본 정보는 `MARIA_DB_URL`, `MARIA_DB_USERNAME`, `MARIA_DB_PASSWORD`로 보존했다.

## 요구사항 대조

| 요구사항 | 산출물 / 증거 | 상태 |
| --- | --- | --- |
| MariaDB 저장소를 SQLite로 교체 | `build.gradle`, `application.yml`, `.env.example`, `schema.sql` | 완료 |
| 프로그램 구조 변경 | `BookDataRepository`, `BookVolumeRepository`, `BranchInventoryRepository`의 SQLite SQL 변경, 기존 MariaDB migration 리소스 제거 | 완료 |
| 데이터 마이그레이션 | `migrate_maria_to_sqlite.js`, `npm run db:migrate:maria-to-sqlite -- ./bookshelf.sqlite`, `npm run db:verify:migrated -- ./bookshelf.sqlite` | 현재 샌드박스 DNS 제한으로 미완료 |
| 화면 동작 검증 | `scripts/verify_screen_smoke.sh`, `npm run screen:smoke` | 자동 검증 스크립트는 준비됨. 실제 실행은 현재 샌드박스 Gradle/서버 제한 및 SQLite JDBC 미캐시로 미완료 |
| 보고 | `docs/sqlite-migration-report.md` | 완료 |

로컬의 ignored `.env`는 마이그레이션 성공 후 SQLite URL로 바꾸기 전까지 애플리케이션 기본 SQLite 설정을 덮어쓸 수 있다.
현재 `.env` 기준 SQLite 런타임 DB 경로는 `/home/trstyq/code/bookshelf/bookshelf.sqlite`다.

## 통과한 검증

다음 명령은 현재 환경에서 성공했다.

```bash
sqlite3 -batch /tmp/bookshelf-schema-final.sqlite < src/main/resources/schema.sql
sqlite3 /tmp/bookshelf-schema-final.sqlite ".tables"
sqlite3 /tmp/bookshelf-schema-final.sqlite "PRAGMA foreign_key_check;"
node --check migrate_maria_to_sqlite.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package json ok')"
npm run db:verify:sqlite
yq '.' src/main/resources/application.yml
npm run css:build
npm run verify:local
scripts/verify_java_repositories.sh
bash scripts/verify_java_compile.sh
bash scripts/verify_migrated_sqlite.sh /tmp/bookshelf-schema-final.sqlite
```

화면 smoke test 스크립트는 앱 서버가 없는 상태에서도 임시 SQLite DB를 대상으로 fixture 생성 후 실패 경로의 cleanup을 확인했다. 서버 연결 실패 후 `books`, `member`, `branchbook`에 smoke fixture가 남지 않았다.

`npm run verify:local`은 다음을 포함한다.

- 마이그레이션 스크립트 문법 검사
- shell script 문법 검사
- 화면 smoke test 스크립트 문법 검사
- SQLite 스키마/샘플 데이터 smoke test
- repository 계층 `javac` 검증
- 전체 main/test Java 소스 직접 컴파일 검증
- CSS 빌드

SQLite smoke test에서는 다음을 확인했다.

- 책 1건과 권 1건 삽입
- `ON CONFLICT(uuid)`로 지점 재고 upsert
- `branch_inventory_summary` 재생성
- SQLite `LIKE` 검색
- `PRAGMA foreign_key_check`

관측된 smoke-test 핵심 결과:

```text
B1|강남점|1|1|9000
```

## 막힌 검증

MariaDB 데이터 이관은 현재 샌드박스에서 MariaDB 호스트 이름을 해석하지 못해 실패했다.

```text
Migration failed: getaddrinfo EAI_AGAIN www.sfdevhub.com
```

같은 `.env` 접속정보를 사용해 `mysql` CLI로도 확인했으며, 인증 단계 전에 DNS에서 실패했다.

```text
ERROR 2005 (HY000): Unknown server host 'www.sfdevhub.com' (-3)
```

Gradle 테스트와 앱 실행, 브라우저 화면 검증은 현재 샌드박스에서 Gradle 시작 단계가 막혀 수행하지 못했다. 잡혀 있는 Java/Gradle 경로로 실행해도 동일하다.

```text
JAVA_HOME=/home/trstyq/opt/jdk-21
GRADLE_HOME=/home/trstyq/opt/gradle-8.13
Could not determine a usable wildcard IP for this machine.
```

Gradle을 우회해 직접 컴파일한 클래스에서 Spring Boot 기동도 시도했다. Tomcat 초기화까지 진행됐지만, 새 `org.xerial:sqlite-jdbc` jar가 로컬 Gradle/Maven 캐시에 없고 Gradle이 현재 환경에서 받을 수 없어 datasource 생성에서 중단됐다.

```text
Cannot load driver class: org.sqlite.JDBC
```

## 남은 완료 게이트

MariaDB 호스트에 접근 가능하고 Gradle/서버 소켓을 사용할 수 있는 환경에서 다음을 실행해야 한다.

```bash
npm run db:migrate:maria-to-sqlite -- ./bookshelf.sqlite
npm run db:verify:migrated -- ./bookshelf.sqlite
./gradlew test
BOOKSHELF_DB_URL='jdbc:sqlite:./bookshelf.sqlite?foreign_keys=on&busy_timeout=5000' ./gradlew bootRun
```

앱이 뜬 뒤 자동 smoke test를 실행한다.

```bash
BOOKSHELF_BASE_URL=http://localhost:25647 \
BOOKSHELF_DB_PATH=./bookshelf.sqlite \
npm run screen:smoke
```

이 스크립트는 SQLite DB에 smoke test 계정과 샘플 책/지점 재고를 임시로 추가한 뒤 다음 화면을 확인하고 fixture를 정리한다.

- 로그인 흐름
- 대시보드
- 책 목록, 검색, 필터, 상세
- 상품 검색 화면
- 지점 재고 대시보드/목록

회원가입 화면은 기본 설정이 `REGISTRATION=false`라서 smoke test 대상에 포함하지 않았다. 회원가입까지 확인하려면 앱을 `REGISTRATION=true`로 실행한 뒤 별도 수동 확인이 필요하다.
상품 가져오기와 Aladin 중고 재고 조회처럼 외부 API에 의존하거나 데이터를 쓰는 경로도 현재 자동 smoke test에는 포함하지 않았다. 이 경로들은 앱 기동과 화면 smoke test가 통과한 뒤 수동 또는 별도 통합 테스트로 확인해야 한다.
