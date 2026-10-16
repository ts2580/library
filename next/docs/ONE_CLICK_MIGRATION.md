# 기존 프로필에서 버튼으로 이전

관리자 한 명만 사용하는 기존 Spring 책장을 위한 이전 패치입니다. **프로필 → Next.js 책장으로 이전 → 새 책장으로 이전**을 누르면 DB·표지를 복사하고, Next 스키마 적용·검사 후 새 웹·워커를 시작합니다. DB 업로드나 표지 ZIP을 따로 만들 필요가 없습니다.

코드·로컬 빌드·격리 테스트까지 완료한 패치입니다. 현재 실행 중인 기존 서비스에는 아직 설치하거나 재시작하지 않았습니다. 패치를 포함한 Spring을 실행해야 버튼이 표시됩니다.

## 로컬에서 준비

Node.js 22 이상과 Java 21이 필요합니다. 저장소 루트에서 한 번 빌드합니다.

```bash
cd next
npm ci
npm run build
cd ..
npm ci
npm run css:build
./gradlew bootJar --no-daemon
```

현재 사용하는 실행 방식으로 Spring을 새 JAR로 재시작합니다. 기본 경로는 기존 `data/bookshelf.sqlite`, `data/covers/`, Next 앱 `./next`입니다. 별도로 Next 웹·워커를 먼저 실행하지 마세요. 버튼이 두 프로세스를 시작합니다.

관리자 `trstyq`로 기존 프로필에서 **새 책장으로 이전**을 누릅니다. 완료 후 **새 책장 열기**로 이동하고 기존 계정으로 다시 로그인합니다. 새 앱은 기본 `25648` 포트, 기존 Spring은 `25647`에서 읽기 전용으로 유지됩니다.

| Spring 설정 | 용도 |
|---|---|
| `BOOKSHELF_NEXT_APP_DIR` | Next 앱 경로, 기본 `./next` |
| `BOOKSHELF_NEXT_NODE` | Node 실행 파일, 기본 `node` |
| `BOOKSHELF_NEXT_PORT` | 새 앱 포트, 기본 `25648` |
| `BOOKSHELF_NEXT_PUBLIC_URL` | 프록시·HTTPS 사용 시 새 앱의 외부 접속 주소 |

리버스 프록시 환경에서는 새 앱을 프록시에 연결하고 `BOOKSHELF_NEXT_PUBLIC_URL`을 지정합니다. 버튼은 DNS·프록시·배포 설정을 변경하지 않습니다. 로컬 직접 접속은 별도 주소 설정 없이 동작합니다.

## Docker를 사용하는 경우

기존 Java 이미지에는 Node·Next 빌드가 없으므로 일회성 이전용 이미지가 필요합니다. 기존 쓰기 프로세스를 중지한 상태에서 실행합니다. `.env`는 현재 알라딘 설정을 유지합니다.

```bash
docker compose -f docker-compose.migration.yml up -d --build
```

기존 프로필에서 버튼을 누르면 됩니다. 이 Compose는 기존 `./data`와 새 `./next/data`를 별도로 연결합니다. 기존 운영 데이터가 다른 디렉터리/볼륨에 있다면 `migration` 서비스의 `/data` 마운트를 그 경로로 지정해야 합니다.

새 책장을 확인한 뒤 Java를 제거하고 Next만 운영하려면:

```bash
docker compose -f docker-compose.migration.yml down
docker compose -f docker-compose.next.yml up -d --build
```

같은 `./next/data`를 웹·워커에 연결하므로 이전 결과가 유지되고 기존 포트 `25647`을 사용합니다. 별도 호스트 경로로 바꿨다면 두 Compose의 새 데이터 마운트도 일치시킵니다. 일반 `next/docker-compose.yml`의 빈 named volume으로 바꾸면 이전 데이터가 보이지 않으므로 위 전환용 Compose를 사용합니다.

## 버튼의 처리 순서

1. 관리자 권한·CSRF를 검사합니다. 원본 경로·명령·소유자를 브라우저 입력으로 받지 않습니다.
2. 기존 앱의 새 저장 요청을 차단하고 진행 중인 HTTP 저장·재고 갱신·표지 복원 작업을 최대 5분간 기다립니다.
3. 원본 DB를 읽기 전용으로 열어 무결성과 단일 관리자 계정을 확인합니다. SQLite online backup으로 WAL의 커밋 데이터까지 일관되게 복사합니다.
4. `next/data/migrations/handover-<id>/`에 표지를 복사하고 SHA-256으로 검증합니다. 심볼릭 링크는 거부합니다.
5. 복사본만 마이그레이션합니다. 회원·도서·권·재고 개수, 외래키, 무결성, 소유자 및 표지를 검사합니다. 책에 아직 쓰지 않은 카테고리도 유지합니다.
6. 검증 후 `next/data/active-migration.json`에 새 경로를 기록하고 웹·워커를 시작합니다. 이 파일에 기밀 값은 저장하지 않습니다. 기존 알라딘 설정은 자식 프로세스의 환경변수로 전달합니다.
7. 새 앱의 health 응답을 확인하고 완료 및 데이터 개수를 표시합니다. 기존 책장은 계속 읽기 전용으로 남습니다.

웹·워커·DB CLI는 재시작 시 `active-migration.json`을 사용합니다. `.env.example`의 기본 DB 경로도 이 기록을 따릅니다. 기본값과 다른 `BOOKSHELF_DB_PATH`/`BOOKSHELF_DATA_DIR`를 명시하면 해당 경로가 우선하므로, 운영에서 예전 검증 경로가 남지 않게 확인하세요.

## 실패·재시작·복구

- 새 데이터 활성화 전 오류는 원본의 쓰기 제한을 해제합니다. 다시 누르면 새 디렉터리에서 재시도하며 실패한 복사본은 원인 확인용으로 남깁니다.
- 활성화 이후에는 원본을 계속 읽기 전용으로 보호합니다. **새 책장 다시 시작**은 이미 이전한 DB를 사용하며, 새 앱의 변경분을 원본으로 덮어쓰지 않습니다.
- 이전용 Spring을 종료하면 관리 중인 Next 웹·워커도 종료됩니다. Spring 재시작 후 **새 책장 다시 시작**을 누르거나 위 Next 전용 구성으로 전환합니다.
- 기존 DB 옆의 `next-migration-state.json`이 읽기 제한과 재시작 정보를 보존합니다. 기록이 손상되거나 활성 데이터와 불일치하면 자동 복사를 중지합니다.
- 롤백은 새 웹·워커를 종료한 뒤 보존된 기존 DB로 Java를 실행하는 방식입니다. 새 앱의 변경은 원본에 자동 역반영되지 않습니다. 이전 상태 파일 제거로 원본 쓰기를 재개하는 조치는 새 앱이 완전히 종료되었고 원본으로 돌아가기로 결정한 뒤에만 수행합니다.

## 카테고리 입력

기존 Spring 수동 추가와 Next 직접 추가/수정 모두 저장된 카테고리를 콤보박스로 표시합니다. 마지막 **카테고리 추가**를 선택하고 이름을 입력한 뒤 **추가**를 누르면 책을 만들기 전에도 저장됩니다. 새 이름이 자동 선택되고 새로고침 후에도 사용할 수 있습니다.

## 이전 후 원본 삭제 버튼

Next 프로필의 **기존 데이터 정리 → 기존 DB·표지 삭제**는 관리자 전용입니다. 현재 앱이 실제 원클릭 이전본을 사용하고, 이전 전 DB 백업이 정상이며, 원본 DB가 백업과 같고 원본 표지가 이전본에 모두 보존된 경우에만 삭제합니다. 기존 DB나 표지를 사용하는 Linux 프로세스가 있으면 먼저 종료해야 합니다.

삭제 대상은 `BOOKSHELF_LEGACY_DATA_DIR` 안의 `bookshelf.sqlite`, 해당 WAL/SHM, `covers/`입니다. 기본 경로는 `../data`이며, 서버 설정만 사용하고 브라우저에서 삭제 경로를 받지 않습니다. 현재 DB·표지, 이전 전 자동 DB 백업, 기존 수동 백업(`bookshelf.sqlite.back`)·로그·이전 상태 기록은 삭제하지 않습니다.

확인창에서 취소하면 삭제하지 않습니다. 별도 SQLite 잠금으로 중복 실행을 막고, 원본을 임시 정리 폴더로 옮긴 뒤 삭제합니다. 삭제 중 중단되면 같은 버튼으로 남은 정리를 재시도할 수 있습니다. 정리 후 원본 경로에 새 파일이 생기면 자동 재삭제를 차단합니다. 삭제 이후 원본으로 돌아가려면 남겨둔 DB 백업과 별도로 보존된 표지에서 복원해야 합니다.

Docker 전환용 `docker-compose.next.yml`은 웹에 `./data:/data`를 추가 연결하고 `BOOKSHELF_LEGACY_DATA_DIR=/data`로 설정합니다. 원본이 다른 호스트 경로에 있다면 이 마운트를 맞춥니다. 워커에는 원본 마운트가 필요하지 않습니다. 기존 Java가 아직 실행되는 이전용 컨테이너 안에서는 삭제 버튼이 차단되므로, 먼저 Next 전용 운영 구성으로 전환합니다.

## 검증 재현

```bash
./gradlew test bootJar --no-daemon
cd next
npm run verify:source
npm run build
npm run test:e2e
npm run test:handover
cd ..
docker build -f Dockerfile.migration -t bookshelf:migration-bridge-local .
cd next
npm run test:handover:docker
docker build -t bookshelf-next:canary-local .
npm run test:cleanup:docker
```

브라우저 검증은 임시 DB·더미 계정과 별도 Spring 포트 `25649`·Next 포트 `25650`을 사용합니다. 실제 사용자 서비스·DB에는 이전 버튼을 호출하지 않습니다. Docker 검증도 고유한 임시 컨테이너·데이터만 사용하고 종료 시 정리합니다. 스크린샷과 결과는 Git 제외 경로 `test-results/handover/`, `test-results/handover-docker/`에 남습니다. Playwright가 결과 디렉터리를 정리하므로 위 명령들은 순서대로 실행합니다.
