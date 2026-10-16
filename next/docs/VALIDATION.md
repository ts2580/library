# Next.js 마이그레이션 검증 기록

2026-10-17 KST, `feat/nextjs-migration`의 로컬 작업 기준입니다. `temp/bookshelf-next-source.zip`을 `next/`에 가져와 실제 의존성 설치와 실행으로 검증했습니다. 초안에 적힌 과거 업로드 DB 검증 수치는 이번 결과에 사용하지 않았습니다.

## 실행 결과

| 검사 | 결과 |
|---|---|
| 깨끗한 `npm ci` | 통과, npm 12 이름 기반 네이티브 설치 허용 확인 |
| TypeScript/TSX 구문·로컬 import·Client/Server 경계 | 통과 |
| `tsc --noEmit` | strict 설정으로 통과, 선언 스텁 미사용 |
| 기존 Spring 테스트 | 189건 통과 |
| Vitest | 단위·통합 50건 통과 |
| 프로덕션 `next build` | 통과 |
| Playwright | 데스크톱 14건 + 모바일 14건, 총 28건 통과·건너뛰기 없음 |
| `npm audit` | 전체 의존성 권고 0건 |
| Node 22 Docker 이미지 빌드 | 통과 |
| Docker 웹·워커 실행 | UID 1001, 동일 SQLite 볼륨, 로그인 HTTP 200·익명 API 401 확인 |
| Docker DB 검사 | 무결성 `ok`, 외래키 위반·고아 데이터 0건 |
| 기존 프로필 원클릭 이전 | 실제 Spring·Next·워커·브라우저로 통과, 실패 재시도·재시작 후 변경분 보존 확인 |
| 원클릭 이전 Docker 이미지 | 빌드 및 실제 프로필 버튼으로 DB·표지 이전·웹·워커 실행 통과 |
| 원본 삭제 버튼 | 실제 브라우저에서 사용 중인 Spring 차단·확인 취소·삭제 후 Next 데이터 보존 확인 |
| 원본 삭제 Docker 검사 | UID 1001 웹에서 원본 DB·표지 삭제, 컨테이너 경로가 달라도 자동 백업 인식, 인증된 표지 HTTP 200 확인 |

로컬 검증은 Node 24.21.0, 컨테이너는 Node 22.23.3에서 실행했습니다. 테스트 컨테이너와 전용 임시 볼륨은 검증 후 제거했습니다. 로컬 이미지 `bookshelf-next:migration-local`은 남겨 두었습니다.

## 기존 데이터 복사본

초기 검증 대상은 `next/data/migration-check/bookshelf.sqlite`입니다. 원본 `data/bookshelf.sqlite`에서 SQLite online backup으로 일관된 사본을 만들고 표지를 별도 복사했습니다. 이후 작업 공간에서 원클릭 이전이 수행되었고, 현재 `25647`의 Next가 실제 `handover-*` 이전본을 열고 있음을 확인했습니다.

| 항목 | 이전 전후 |
|---|---:|
| 회원 | 1 → 1 |
| 도서 | 1,198 → 1,198 |
| 권 | 4,281 → 4,281 |
| 지점 재고 | 0 → 0 |
| 소유자 없는 도서 | 0 |
| 고아 권 | 0 |
| 외래키 위반 | 0 |
| 무결성 | `ok` |
| 누락 표지 참조 | 원본 13건, 복사본 13건으로 동일 |

재고가 있는 이전 DB, 애매한 권 연결, 소유자 누락 상황은 별도 격리 fixture로 검증했습니다. 부분 권차를 정수로 반올림해 연결하지 않으며, `volume`이 같은 권이 여러 개면 연결을 보류합니다.

## 주요 회귀 검사

- 기존 SHA-256 및 BCrypt 비밀번호 호환, 만료 세션 조회, 회원가입 비활성화, 관리자 API 제한.
- 계정 간 도서·표지 접근 차단 및 SQL 변경 소유권 검사.
- `%`, `_`, `!`, 역슬래시를 리터럴로 검색, 한글 NFC/NFD 입력 처리.
- 보유 권 ISBN 검색, 지점 재고 검색과 24건 페이지 이동.
- 재고 작업의 API 키 누락·중복 등록·0건 대상·429 중단·재시작 집계 복구.
- 선택한 알라딘 페이지의 서버 재조회, 전체 선택 검증 후 원자적 저장, 뒤 페이지 우선 및 페이지 내 화면 순서 보존.
- 페이지 조회 실패 후 기존 선택 유지 및 등록 버튼 복구.
- 직접 추가 내 기존 책 검색·알라딘 미리보기, 검색 페이지의 새 책 등록·기존 책에 이어 넣기, 직접 입력 메타데이터 보존.
- 항목별 외전 처리, 기존 `seq`와 외전을 제외한 정규 권차 이어 붙이기, 보유 ISBN 선택 차단과 서버 중복 검증.
- 직접 추가 접기·다시 열기 초기화, 검색 결과가 없는 새 책의 책만 등록, 알라딘 외 직접 등록.
- 실제 직접 추가 API와 Server Action으로 도서·권 생성과 삭제.
- 모든 검색 폼과 내부 책 검색·알라딘 조회의 지연 요청 중 스피너 표시 및 완료 후 해제.
- 실제 별도 재고 워커의 큐 처리·API/HTML 파싱·저장·완료 상태와 새로고침 없는 목록·지점 집계 갱신. 구매 완료·구매 불필요 권 제외.
- XLSX 내보내기·가져오기 왕복, ZIP 청크 업로드·실제 별도 워커 복원.
- 데스크톱·모바일 주요 화면과 가로 넘침, 클라이언트 런타임 오류 검사.
- 저장만 한 카테고리 선택, 새 카테고리 추가·자동 선택·새로고침 후 재사용 및 이전 후 보존.
- 기존 관리자 프로필에서 실제 원클릭 이전, 포트 충돌 실패 후 기존 앱 쓰기 복구, 완료 후 기존 저장 차단.
- 이전용 Spring 재시작 후 기존 데이터 재복사 없이 새 앱의 저장 변경 보존, 기본 `.env` 경로의 활성 DB 인식.

Playwright는 전용 임시 DB·계정·웹·워커를 생성합니다. 알라딘 응답만 해당 웹·워커 테스트 프로세스에서 목업으로 대체하며 정상 실행 명령에는 목업을 로드하지 않습니다. 실제 알라딘 API·HTML 응답과 원격 운영 배포는 별도 검증 대상입니다.

원본 삭제 회귀 검사는 이전 후 원본 변경, 누락·변경 표지, 백업 누락, 현재 DB와 겹치는 삭제 경로, 심볼릭 링크, 사용 중인 원본·중복 정리, 중단 후 재시도와 재생성된 원본 보호를 포함합니다. Spring 컨텍스트 테스트는 인메모리 SQLite로 격리해 실제 사용자 DB나 미리 만들어진 `data/`에 의존하지 않습니다.

## 재현 명령

`next/`에서 실행합니다. E2E 전에는 테스트용 `25648` 포트를 비웁니다. 일반 개발·운영의 기본 포트는 `25647`이며, 이전 버튼으로 동시 실행하는 새 앱만 `25648`을 사용합니다.

```bash
npm ci
npm run verify:source
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
docker build -t bookshelf-next:migration-local .
npm run test:docker
```

npm 12의 원격 tarball 정책으로 `EALLOWREMOTE`가 발생하면 설치 명령에만 `--allow-remote=all`을 지정합니다. Docker 검증 상세는 생성되는 `test-results/docker-smoke.json`, 브라우저 스크린샷·실패 trace는 `test-results/`에 저장하며 Git에서 제외합니다.

PR 준비 검증은 실행 중인 Next와 별도 소스 복사본에서 수행했습니다. 원격 배포·이미지 발행은 수행하지 않았습니다. 실제 작업 공간에서는 요청에 따라 Java 원본 DB·표지를 정리했고, 이후 Next 도서 1,198개·권 4,281개·표지 5,451개, DB 무결성 `ok`, 외래키 위반 0건, health HTTP 200을 재확인했습니다. 기존 수동 DB 백업과 로그·이전 전 자동 DB 백업은 보존했습니다.

원클릭 패치 설치·운영·복구 및 검증 명령은 [ONE_CLICK_MIGRATION.md](ONE_CLICK_MIGRATION.md)를 참고하세요. 원클릭 브라우저 결과는 `test-results/handover/result.json`, Docker 결과는 `test-results/handover-docker/result.json`에 저장합니다. Docker 이전용 로컬 이미지는 `bookshelf:migration-bridge-local`입니다.

원본 정리 Docker 결과는 `test-results/legacy-cleanup-docker/result.json`에 저장하며 `bookshelf-next:canary-local` 이미지를 사용합니다.


직접 추가·검색 기능 복원은 별도 `temp/manual-review-*` 소스 사본과 임시 DB에서 검증했습니다. PC·모바일 화면 캡처는 `test-results/manual-registration/`에 보관합니다. 실제 작업 공간을 읽기 전용으로 확인했을 때 Next 웹은 실행 중이고 재고 작업은 `IDLE`이었으며, 별도 재고 워커는 실행 중이지 않았습니다. 로컬 재고 갱신에는 `next/`에서 `npm run worker` 실행이 필요합니다. 실제 알라딘 API 호출과 배포는 이번 검사에 포함하지 않았습니다.

이번 등록 기능 후속 변경에서는 Java 소스와 Docker 설정을 바꾸지 않았습니다. Spring 189건·Docker 검증은 이전 패치의 기록이며, 후속 변경에서는 `bootJar` 재빌드와 원클릭 이전·재시작·정리 버튼 회귀 검사를 다시 통과했습니다.
