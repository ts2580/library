# Bookshelf 4.2.0

지점 재고 갱신을 일시중지·재개하고, 실패를 작업 기록별로 관리하는 기능 릴리스 후보입니다. 현재 main 승격 및 배포 준비 단계이며, GitHub Release·npm·Docker 이미지 발행과 운영 서비스 교체는 아직 진행하지 않았습니다.

## 변경 내용

- 전체·책별·선택 재고 갱신은 요청을 받으면 대상 권의 이전 재고를 바로 삭제하고 새 조회 결과로 갱신합니다.
- 지점 재고 화면에서 작업을 일시중지하고 남은 대상부터 재개할 수 있습니다.
- 작업 기록 상세에서 그 작업의 실패 내역을 확인하고 일괄 재시도하거나 CSV·JSON으로 다운로드합니다. 로그인 오류 안내는 한 번만 표시합니다.
- 재고 검색과 알라딘 검색·책 추가 요청에 별도 동시 요청 quota를 적용합니다. ISBN과 확인된 상품번호 대응을 DB에 보관해 상품 검색을 줄입니다.
- 로그인 인증이 필요한 상품은 서버의 전용 Chromium 세션으로 조회할 수 있습니다. 기본 HTTP 공개 페이지 조회와 브라우저 인증 연결은 선택 구성입니다.
- 검색 결과에서 계정 소유권과 ISBN을 다시 검증하고, 책장 상세 검색에서 사용하지 않는 전체 시리즈 집계를 건너뜁니다.
- 대기 작업과 기록을 새 스키마로 이관할 때 대상 재고 초기화를 반영합니다. 준비 중인 브라우저 세션 ID도 재연결 때 회수할 수 있도록 저장합니다.

## 기존 설치 업데이트

DB 스키마가 7에서 11로 순차 갱신됩니다. 웹 또는 워커가 시작될 때 자동 백업 후 migration 8–11을 적용합니다. 기존 `.env`, DB, 표지, 백업, Docker 볼륨을 보존하고 **웹과 워커를 모두 4.2.0으로 함께 교체**합니다. DB 스키마를 낮추는 downgrade는 제공하지 않으므로, 업데이트 전 DB와 표지를 같은 시점으로 백업하세요.

정식 Release와 이미지 발행을 확인한 뒤 Docker에서 실행합니다.

```sh
BOOKSHELF_IMAGE=trstyq/bookshelf:4.2.0 docker compose -f docker-compose.release.yml pull
BOOKSHELF_IMAGE=trstyq/bookshelf:4.2.0 docker compose -f docker-compose.release.yml up -d
```

npm 설치는 [npm 사용 안내](NPM.md)를 따릅니다. 현재 브랜치의 4.2.0 예시는 발행 전 후보 버전을 가리킵니다.

### 선택: 서버 브라우저 로그인

로그인 요구 상품을 조회하려면 `.env`에 `ALADIN_BROWSER_OWNER`(Bookshelf 사용자명)와 `ALADIN_BROWSER_VNC_PASSWORD`를 설정하고 웹·워커와 같은 Compose 파일 조합에 `docker-compose.aladin.yml`을 추가합니다.

```sh
docker compose -f docker-compose.release.yml -f docker-compose.aladin.yml up -d
```

VNC는 호스트의 `127.0.0.1:7900`에만 연결합니다. 접속할 때 SSH 터널을 열고 프로필의 전용 브라우저 연결 화면에서 알라딘에 로그인합니다. 비밀번호는 저장소에 기록하지 않습니다.

### 롤백

새 버전에서 오류가 나면 웹·워커를 함께 중지하고, 4.1.0 이미지와 업데이트 전 백업 DB·표지를 함께 복원합니다. 4.2.0에서 수행한 재고 갱신은 요청 시 이전 재고를 지우므로, 구버전 이미지만 되돌려서는 삭제된 재고가 복구되지 않습니다.

## 검증과 발행 상태

아래 검증은 release 브랜치의 최종 커밋을 대상으로 완료한 뒤 `docs/WORKLOG_4.2.0.md`에 결과와 커밋 SHA를 기록합니다. main PR 병합, `v4.2.0` 태그·GitHub Release, npm `latest`, Docker `4.2.0`·`latest`, 운영 컨테이너 교체는 각각 별도 단계입니다.
