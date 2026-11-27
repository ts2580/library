# Bookshelf 4.2.0 준비 기록

## 범위

PR #72와 #74가 canary에 병합된 뒤, PR #73이 2026-11-27 KST에 main에 병합되어 4.2.0이 정식 버전이 되었습니다.

## #74 반영 전 검증 기록

| 확인 | 결과 |
|---|---|
| `npm run verify:source` | 통과: 구문·구조·타입 검사, 36개 파일 / 432개 테스트 |
| `npm run build` | 재시도 후 통과. Next.js 16.4.2의 보안 취약 경고가 남음 |
| 전체 Playwright E2E | 1차 255 통과·8 실패·1 건너뜀. 실패 8개 기대값/대기 조건을 보정하고 PC·모바일로 해당 8개 재실행, 모두 통과 |
| 가입 E2E | 통과: desktop/mobile 2개 |
| npm tarball 독립 설치 검증 | 로컬 4.2.0 tarball 설치·웹/워커/로그인/종료·재시작 검증 통과. 작업 트리 빌드이므로 발행물 아님 |
| Docker 이미지·컨테이너 검증 | 통과: 로컬 이미지 빌드, UID 1001, 공유 `/data`, 익명 API 401, SQLite 무결성 및 외래 키 0건 |
| Docker 이전 데이터 정리 검증 | 통과: 관리자 인증, DB·표지 보존, 인증 표지 접근 |
| Compose·버전 정합성 | 통과: release Compose 렌더링, package/lock 버전 4.2.0 일치 |

## main 정식 릴리스 검증

- main 병합 커밋 `43c3c41`에서 `npm run verify:source` 통과, 36개 파일 / 432개 테스트
- `npm run build` 통과, Next.js 16.4.6
- Playwright 전체 264개에서 257개 통과, 6개 실패, 1개 건너뜀. 새 단일 재고 규칙에 맞춰 fixture를 조정한 뒤 해당 세 spec 12개 PC·모바일 테스트와 별도 재고 작업 2개를 다시 실행해 모두 통과
- `npm run test:docker -- trstyq/bookshelf:4.2.0` 통과. Node 22, UID 1001, 공유 볼륨, 인증 없는 API 401, SQLite integrity `ok`, FK 오류 0건
- Docker 이전 데이터 정리 검증 통과. 관리자 인증, DB·표지 보존, 인증 표지 확인
- npm 독립 설치 검증 통과. 웹·워커·로그인·종료·재시작·마이그레이션 CLI 확인
- npm 계정 `trstyq` 로그인 확인
- 릴리스 커밋 `ab770cc` npm tarball SHA-256 `1bfdad206c4d354b3392e9a23f65ea584bf2c49e0139fb892040881197e9d5b3`

## 참고 사항

- 첫 전체 E2E의 실패는 ISBN 단건 조회 집계 문구 기대값과 지점명 텍스트 검색의 모호성, 완료 상태 전파 테스트의 즉시 단정/정확한 polling 횟수 기대였습니다. 테스트를 화면 결과와 비동기 완료 조건에 맞게 보정한 뒤 실패 8개를 재실행했습니다.
- 로컬 npm tarball SHA-256: `7199ad33bc7f3c04cefa826fb39dc8a931ddd8dab77b7c074f167371c11f646a`. Provenance는 `sourceType=commit`, `sourceCommit=ab770cc4b4e6032526f886977b263b984f4d9403`입니다.
- Docker 검증 이미지 ID: `sha256:47dd353b0ac49a80319f5f87af134b6ec50755acb6cca46f3eb612ddef3385`.
- Next.js 빌드는 보안 취약 버전 경고 후 재시도에서 완료되었습니다. 이후 canary PR #74에서 16.4.6으로 올렸으며 해당 병합 커밋 ab152dc를 release 브랜치에 반영했습니다.

## 발행 상태

- main PR: [#73](https://github.com/ts2580/library/pull/73), merged
- 4.2.0 tag, GitHub Release, npm package, Docker image: pending
- 운영 서비스 교체: 별도 단계
