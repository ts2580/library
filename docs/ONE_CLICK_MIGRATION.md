# Java 이전과 3.5.0 전환

3.5.0은 Next.js만 포함합니다. 해당 정식 태그·이미지 발행을 확인한 뒤 전환합니다. Java·Gradle·Java가 Next를 실행하는 이전용 코드는 [v3.0.0-ca2 태그](https://github.com/ts2580/library/tree/v3.0.0-ca2)에 보존돼 있습니다.

## 아직 Java에서 이전하지 않은 경우

먼저 `trstyq/bookshelf:3.0.0-ca2-migration`으로 기존 Java 데이터를 실행합니다. [ca2 Docker 이전 안내](https://github.com/ts2580/library/releases/download/v3.0.0-ca2/DOCKER_MIGRATION_CA2.md)와 [이전용 Compose](https://github.com/ts2580/library/releases/download/v3.0.0-ca2/docker-compose.migration.3.0.0-ca2.yml)를 사용합니다. 이 버전의 자동 이전은 관리자 한 명만 있는 DB를 지원합니다.

Java의 프로필에서 **새 책장으로 이전**을 누르고 `25648`의 Next에서 기존 계정·책·표지를 확인합니다. 이후 이전 컨테이너를 중지합니다. 이 컨테이너를 중지하면 내부의 Next 웹·워커도 함께 종료됩니다. 3.5.0 루트에서는 Java를 빌드하거나 시작하지 않습니다.

## 이전 완료한 Docker

기존 새 볼륨을 그대로 사용합니다. 새 DB 생성이나 재마이그레이션은 필요하지 않습니다.

| 구성 | 이미지 | 새 볼륨 경로 | 기존 원본 경로 |
|---|---|---|---|
| 이전 중 | `3.0.0-ca2-migration` | `Bookshelf-next:/app/next/data` | `Bookshelf:/data` |
| ca2 Next 단독 | `3.0.0-ca2` | 웹·워커 모두 `Bookshelf-next:/app/data` | 웹에 `Bookshelf:/data` |
| 3.4.0 정식 버전 | `trstyq/bookshelf:3.4.0` | 웹·워커 모두 `Bookshelf-next:/data` | 웹에 `Bookshelf:/data/legacy` |
| 3.5.0 정식 버전 (발행 확인 후) | `trstyq/bookshelf:3.5.0` | 웹·워커 모두 `Bookshelf-next:/data` | 웹에 `Bookshelf:/data/legacy` |

루트의 [발행용 Compose](../docker-compose.release.yml)는 두 볼륨을 external로 연결합니다. 기존 이름이 다르면 `.env`에 `BOOKSHELF_DATA_VOLUME`·`BOOKSHELF_LEGACY_VOLUME`을 지정합니다. `.env`의 알라딘 등 기존 설정을 유지합니다. 정식 이미지로 교체하는 명령과 로컬 빌드 검증은 [README](../README.md)에 있습니다.

Compose의 일회성 `permissions` 서비스가 웹 실행 전에 두 볼륨의 소유권을 UID/GID `1001:1001`로 맞춥니다. 이 작업만 root를 사용하며, 웹·워커는 비특권 사용자로 실행합니다. 이전 Java 프로세스를 먼저 종료하고, 초기화 작업이 성공한 뒤 전환합니다. 심볼릭 링크 대상은 따라가지 않으며 각 데이터 경로에서 파일시스템 경계를 넘지 않습니다.

ca2의 `BOOKSHELF_NEXT_VOLUME`도 계속 지원합니다. 새 데이터 볼륨은 비어 있지 않은 `BOOKSHELF_DATA_VOLUME`을 우선하고, 없으면 `BOOKSHELF_NEXT_VOLUME`, 둘 다 없거나 비어 있으면 `Bookshelf-next`를 사용합니다.

현재 소스로 빌드한 이미지에서 새 데이터 볼륨은 `/data`, Java 원본 볼륨은 `/data/legacy`에 연결합니다. 예전 Java 볼륨을 `/data`에 계속 연결하면 다른 DB를 읽게 됩니다. 이미지나 마운트 변경 후에는 컨테이너를 재생성합니다. 이전 Java·Next 워커가 동시에 원본이나 새 DB에 쓰지 않도록 먼저 종료합니다. 원본 정리를 마친 뒤에는 `legacy-data:/data/legacy` 연결을 생략할 수 있습니다. 백업·로그가 남은 예전 볼륨 자체는 삭제하지 않습니다.

## 이전 완료한 로컬 실행

웹·워커와 DB를 사용하는 다른 작업을 모두 종료합니다. `next/data`를 루트 `data`로 통째로 옮기면 DB·WAL/SHM·표지·업로드·백업·이전 기록이 함께 유지됩니다. 예전 루트 `data`의 Java 백업·로그는 새 `data/legacy`에 보존합니다.

아직 이동하지 않은 체크아웃에서는 프로젝트 루트에서 다음을 실행합니다. 대상이 이미 있으면 중단하며 기존 폴더를 덮어쓰지 않습니다.

```bash
(
  set -eu
  test -d next/data
  test ! -e next/data/legacy
  if [ -d data ]; then
    mv data next/data/legacy
  fi
  mv next/data data
  if [ ! -e .env ] && [ -f next/.env ]; then
    cp next/.env .env
  fi
  mkdir -p data/legacy
  test ! -e data/legacy/next-runtime
  mv next data/legacy/next-runtime
)
npm ci
```

기존 루트 `.env`가 있으면 보존된 `data/legacy/next-runtime/.env`와 필요한 설정을 대조합니다. 데이터 경로는 `BOOKSHELF_DATA_DIR=./data`로 지정하고, 예전 `next/`를 가리키던 `BOOKSHELF_DB_PATH`는 제거하거나 `./data/bookshelf.sqlite`로 수정합니다. Java 원본의 기본 경로는 `data/legacy`이며, 이전 `BOOKSHELF_LEGACY_DATA_DIR`를 지정했다면 함께 수정합니다.

이후 루트에서 `npm run dev`·`npm run worker:dev` 또는 프로덕션 명령을 실행합니다. `data/active-migration.json`이 있으면 `data/migrations/handover-*`의 실제 이전본을 사용합니다. Docker도 `/data/active-migration.json`을 같은 방식으로 해석하므로 기록 파일 내용을 고칠 필요가 없습니다. 현재 기록이 잘못됐거나 DB가 없으면 시작을 중단합니다. `next/` 자동 탐색은 제거했으며, 기존 데이터가 남은 체크아웃은 먼저 이동해야 합니다.

## 기존 DB·표지 정리

현재 Next 프로필에는 **기존 데이터 정리** 섹션을 표시하지 않습니다. 이전 기록·백업·원본 데이터와 관리자용 정리 API는 유지되며 자동 삭제는 실행되지 않습니다. 관리자용 정리 기능은 실제 이전본, 이전 전 백업, 원본 DB·표지 일치를 검사하고 원본 사용 프로세스가 있으면 차단합니다.

삭제 대상은 `BOOKSHELF_LEGACY_DATA_DIR` 아래 `bookshelf.sqlite`·WAL/SHM·`covers/`입니다. 새 DB·표지, 이전 전 백업, 기존 수동 백업·로그는 유지합니다. 원본 경로 기본값은 로컬 `data/legacy`, Docker `/data/legacy`입니다. 새 데이터와 원본 경로가 겹치면 삭제하지 않습니다.

원본 삭제 전까지 Java로 되돌아갈 수 있지만 Next에서 변경한 내용이 원본에 자동 반영되지는 않습니다. 원본을 지운 뒤 복원하려면 DB와 표지 백업이 모두 필요합니다.

## 3.5.0 정보 보강

기존 데이터 볼륨과 `.env`를 유지하고 웹·워커를 같은 정식 버전으로 함께 교체합니다. DB 스키마 6은 전체 책 정보 보강의 대상·진행 위치·결과를 저장하는 테이블만 추가합니다. 기존 책·권·저자·설명·표지·재고는 마이그레이션 중 변경하지 않습니다. 프로필의 **전체 책 저자·설명 채우기**를 직접 실행하면 현재 계정의 전체 책과 권에서 빈 메타데이터만 알라딘 API로 보강합니다.
