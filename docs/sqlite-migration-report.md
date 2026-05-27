# SQLite 상태 메모

## 현재 상태

- 기본 datasource는 `jdbc:sqlite:./data/bookshelf.sqlite`를 사용한다.
- 시작 시 `src/main/resources/schema.sql`로 필요한 테이블과 인덱스를 생성한다.
- Repository SQL은 현재 SQLite 기준으로 작성되어 있다.
- 앱 실행용 `.env`에는 SQLite URL을 두지 않아도 된다. 기본 DB 파일은 루트 `data/bookshelf.sqlite`다.
- 기존 MariaDB-to-SQLite 마이그레이션 스크립트는 현재 소스에 존재하지 않는다. 따라서 `package.json`에서도 해당 실행 스크립트와 `mysql2` 의존성을 제거했다.

## 남아 있는 검증 스크립트

```bash
npm run db:verify:sqlite
npm run db:verify:migrated -- ./data/bookshelf.sqlite
npm run screen:smoke
npm run verify:local
```

각 스크립트의 역할은 다음과 같다.

- `db:verify:sqlite`: 임시 SQLite DB에 스키마와 샘플 데이터를 넣고 핵심 테이블, upsert, FK를 확인한다.
- `db:verify:migrated`: 이미 존재하는 SQLite DB 파일의 필수 테이블과 FK를 확인한다.
- `screen:smoke`: 실행 중인 애플리케이션에 로그인한 뒤 주요 화면 응답과 fixture 정리를 확인한다.
- `verify:local`: shell 문법, SQLite 저장소 smoke test, Java 직접 컴파일 검증, CSS 빌드를 순서대로 실행한다.

## 주의점

- `verify:local`의 Java 컴파일 단계는 로컬 Gradle 의존성 캐시가 필요하다.
- 현재 저장소에는 MariaDB 원본에서 SQLite로 데이터를 옮기는 자동 스크립트가 없다. 마이그레이션이 다시 필요하면 별도 스크립트를 새로 추가하고 그때 필요한 DB 드라이버 의존성을 복구해야 한다.
- 화면 smoke test는 애플리케이션 서버가 실행 중이고, `BOOKSHELF_BASE_URL`과 `BOOKSHELF_DB_PATH`가 실제 환경과 맞을 때 의미가 있다.
