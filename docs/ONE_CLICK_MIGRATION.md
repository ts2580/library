# Java 이전과 ca3 전환

ca3은 Next.js만 포함합니다. Java·Gradle·Java가 Next를 실행하는 이전용 코드는 [v3.0.0-ca2 태그](https://github.com/ts2580/library/tree/v3.0.0-ca2)에 보존돼 있습니다.

## 아직 Java에서 이전하지 않은 경우

먼저 `trstyq/bookshelf:3.0.0-ca2-migration`으로 기존 Java 데이터를 실행합니다. [ca2 Docker 이전 안내](https://github.com/ts2580/library/releases/download/v3.0.0-ca2/DOCKER_MIGRATION_CA2.md)와 [이전용 Compose](https://github.com/ts2580/library/releases/download/v3.0.0-ca2/docker-compose.migration.3.0.0-ca2.yml)를 사용합니다. 이 버전의 자동 이전은 관리자 한 명만 있는 DB를 지원합니다.

Java의 프로필에서 **새 책장으로 이전**을 누르고 `25648`의 Next에서 기존 계정·책·표지를 확인합니다. 이후 이전 컨테이너를 중지합니다. 이 컨테이너를 중지하면 내부의 Next 웹·워커도 함께 종료됩니다. ca3 루트에서는 Java를 빌드하거나 시작하지 않습니다.

## 이전 완료한 Docker

기존 새 볼륨을 그대로 사용합니다. 새 DB 생성이나 재마이그레이션은 필요하지 않습니다.

| 구성 | 이미지 | 새 볼륨 경로 | 기존 원본 경로 |
|---|---|---|---|
| 이전 중 | `3.0.0-ca2-migration` | `Bookshelf-next:/app/next/data` | `Bookshelf:/data` |
| Next 단독 | `3.0.0-ca2` 또는 발행 후 `3.0.0-ca3` | 웹·워커 모두 `Bookshelf-next:/app/data` | 웹에 `Bookshelf:/data` |

루트의 [발행용 Compose](../docker-compose.release.yml)는 두 볼륨을 external로 연결합니다. 기존 이름이 다르면 `.env`에 `BOOKSHELF_DATA_VOLUME`·`BOOKSHELF_LEGACY_VOLUME`을 지정합니다. `.env`의 알라딘 등 기존 설정을 유지합니다. ca3 발행 전 로컬 이미지로 검증하는 명령은 [README](../README.md)에 있습니다.

컨테이너 내부 경로를 `/app/next/data`에 그대로 두면 새 앱은 이전본을 읽지 못하고 빈 DB로 시작할 수 있습니다. 이미지나 마운트 변경 후에는 컨테이너를 재생성합니다. 이전 Java·Next 워커가 동시에 원본이나 새 DB에 쓰지 않도록 먼저 종료합니다.

## 이전 완료한 로컬 실행

루트에서 `npm run dev`·`npm run worker:dev` 또는 프로덕션 명령을 실행합니다. 기본 설정일 때 `data/active-migration.json`을 먼저 확인하고, 없으면 기존 `next/data/active-migration.json`을 읽습니다. 오래된 경로가 선택되면 DB·표지·백업은 계속 `next/data/migrations/handover-*`에서 사용하며 파일을 자동 이동하지 않습니다.

현재 경로에 이전 기록이 있지만 DB가 없거나 경로가 잘못됐으면 이전 복사본으로 조용히 되돌아가지 않고 시작을 중단합니다. `BOOKSHELF_DB_PATH`·`BOOKSHELF_DATA_DIR`를 기본값이 아닌 값으로 명시하면 그 설정이 우선합니다. `.env`의 상대 경로는 이제 루트 기준입니다.

## 기존 DB·표지 정리

Next **프로필 → 기존 데이터 정리 → 기존 DB·표지 삭제**는 자동 실행되지 않습니다. 실제 이전본, 이전 전 백업, 원본 DB·표지 일치를 검사하고 원본 사용 프로세스가 있으면 차단합니다.

삭제 대상은 `BOOKSHELF_LEGACY_DATA_DIR` 아래 `bookshelf.sqlite`·WAL/SHM·`covers/`입니다. 새 DB·표지, 이전 전 백업, 기존 수동 백업·로그는 유지합니다. Docker 발행용 Compose는 `/data`로 설정합니다. 로컬 기본값은 `./legacy-data`이며, 예전 Java 원본이 루트 `data/`에 남아 있다면 `./data`로 지정합니다. 새 데이터와 원본 경로가 겹치면 삭제하지 않습니다.

원본 삭제 전까지 Java로 되돌아갈 수 있지만 Next에서 변경한 내용이 원본에 자동 반영되지는 않습니다. 원본을 지운 뒤 복원하려면 DB와 표지 백업이 모두 필요합니다.
