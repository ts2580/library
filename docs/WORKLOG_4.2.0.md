# Bookshelf 4.2.0 준비 기록

## 범위

PR #72가 2026-11-27 KST에 canary에 병합되었습니다. 이 release 브랜치는 해당 canary 변경과 현재 main의 4.1.0 정식 버전을 합쳐 4.2.0 배포 후보를 준비합니다.

## 검증

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

## 참고 사항

- 첫 전체 E2E의 실패는 ISBN 단건 조회 집계 문구 기대값과 지점명 텍스트 검색의 모호성, 완료 상태 전파 테스트의 즉시 단정/정확한 polling 횟수 기대였습니다. 테스트를 화면 결과와 비동기 완료 조건에 맞게 보정한 뒤 실패 8개를 재실행했습니다.
- 로컬 npm tarball SHA-256: `7199ad33bc7f3c04cefa826fb39dc8a931ddd8dab77b7c074f167371c11f646a`. Provenance는 `sourceType=working-tree`, `sourceCommit=null`이며 실제 publish용으로 사용할 수 없습니다.
- 로컬 Docker 이미지 ID: `sha256:be2f9ed9cc86116382c5b0439c11f8b937b97989b29d0ac3074e8fdb776818c7`.
- Next.js 빌드는 보안 취약 버전 경고 후 재시도에서 완료되었습니다. Next security upgrade는 이 PR에 포함하지 않았습니다.

## 발행 상태

- main 대상 PR: [#73](https://github.com/ts2580/library/pull/73), Draft / 보안 업그레이드 후 Ready 전환 예정
- Git 태그·GitHub Release: 미발행
- npm 패키지 / `latest`: 미발행
- Docker Hub `4.2.0` / `latest`: 미발행
- 운영 서비스 교체: 미수행
