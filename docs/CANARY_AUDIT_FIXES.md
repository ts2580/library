# Canary audit fixes

> ca2까지의 구현·검증 당시 기록입니다. 아래 `next/`·Java 실행 경로와 결과는 해당 시점 기준이며, ca3 현재 실행·검증은 [루트 전환 기록](CA3_ROOT_LAYOUT.md)을 참고하세요.

Base: `175cbb35065fd3a386b58253da152fb1f4c69933` (2026-10-17 review).

## Included

- Normal volume edits invalidate inventory on effective ISBN changes, matching the existing Excel import rule. Re-read ISBN/volume under the write transaction after external cover I/O. Only uniquely resolvable legacy links are attached; ambiguous rows are not guessed. The prior renumbering test now preserves its ISBN so it actually tests renumbering rather than a product change.
- Offer identity includes the individual purchase URL, not mutable price, volume number or display name. Indistinguishable branch/grade summaries retain the cheapest known price instead of the last row. Existing rows are replaced on the next explicit refresh; this patch does not run a production data migration.
- One worker per canonical local DB path, enforced before recovery with a process-lifetime SQLite lock on a SEPARATE DELETE-journal database. Main DB writes stay short. Never delete a live `.worker-lock.sqlite` file. Stop all old workers before deploying this version; older workers do not acquire the new lock.
- Stock writes, progress, initial clearing, summary rebuild and completion are fenced by the current job token. A worker that loses its token stops without changing the replacement job's data.
- HTML 429 propagates to the lookup/job stop policy. Failed or unrecognized branch details return `partial: true`, a warning and price-unknown entries (`verified: false`); the worker counts that volume as a failed lookup rather than storing guessed prices. The lookup UI labels partial results. A partial lookup is not a verified complete inventory snapshot.
- Won input rejects negative, fractional, exponent, malformed grouping and unsafe integer values instead of stripping characters into a different amount.
- Keyboard-accessible Excel/ZIP upload buttons. Upload completion and ZIP assembly/restore have separate labels; assembly/restore progress is indeterminate, not falsely 100% complete. Poll after a response with timeout/backoff, preserve a submitted restore job ID in session storage, and support status rechecking. Chunk-level resumable uploads and server job cancellation are not implemented.
- Mobile navigation uses the actual item count. Mobile volume editing occupies the card width instead of remaining squeezed beside the cover.
- Remote cover download has one 30-second budget across DNS, redirects and body consumption, in addition to the existing socket idle timeout. Discarded redirect/error bodies are destroyed. Existing address-pinning, redirect checks and image limits remain.

## Intentionally unchanged / follow-up

The previously specified **clear inventory when a refresh starts** policy is unchanged. A failed/partial refresh can therefore still leave incomplete inventory. Moving to per-volume preservation or staged snapshots requires an explicit behavior decision; summary rebuilding does not restore deleted inventory.

This patch is not a claim that the entire review is resolved. Login throttling and credential-change races, legacy-source deletion guarantees, auth/profile service refactoring, a single migration history, large Excel memory/transaction bounds, moving cover regeneration to a worker, and worker scheduling fairness remain follow-up work. The normal-edit and Excel ISBN rules are aligned, but consolidating both implementations into one service is deferred.

## Validation in the original editing environment

GitHub file baselines were checked against their Git blob SHAs before applying changes. No user DB, `.env`, credentials, migration output or `node_modules` is part of this change.

- Syntax transpilation of changed/new TypeScript/TSX files with the available TypeScript 5.8.3: no syntax errors. This is not the repository's full typecheck.
- Strict typecheck of `money.ts`, `abortable.ts`, `stock-identity.ts`, and Aladin result types: passed without declaration stubs.
- 37 isolated checks: passed. Actual source functions were transpiled and exercised using Node 22.16.0's real SQLite engine through a test compatibility adapter; Zod/Drizzle/external boundaries were mocked. Includes ISBN invalidation, owner isolation, offer identity/minima, job-token fencing, partial responses, abortable waits, and an actual second-process lock attempt. This is **not** a run of Vitest or better-sqlite3.
- 2 cover deadline checks: passed with mocked DNS/HTTPS routed only to a local slow-stream fixture. The 30-second deadline was scaled to 80ms; stalled DNS and a continuously streaming body were both bounded.
- 4 isolated Chromium checks: passed. Mobile editor width increased from 136 to 222px at a 320px viewport and from 206 to 292px at 390px; native upload buttons activated file selection with Enter/Space. These are markup/CSS fragment checks, **not** a running Next app.

The container could not resolve `github.com` or `registry.npmjs.org`; locked npm dependencies were unavailable. `npm ci`, repository-wide typecheck, production build, Vitest and Next/Playwright E2E were **not executed** here. Existing validation records from other environments are not reused as this patch's results.

Added Vitest regressions and `tests/e2e/audit-ui.spec.ts` are intended for the real dependency environment. Run from `next/` before merging:

```sh
npm ci
npm run verify:source
npm run build
npm run test:e2e
```

Also exercise duplicate worker startup and crash recovery in the target Docker volume before deployment. A single local filesystem/host is required; the process lock is not a distributed queue.

## 로컬 저장소 분석 및 추가 수정 (2026-10-17)

원격 `f17fca5`를 별도 작업 디렉터리에서 분석했습니다. 위 초기 환경의 대체 SQLite·부분 검사와 구분하여, lockfile에 고정된 실제 의존성인 `better-sqlite3`, Next.js, Playwright를 사용했습니다. 테스트 DB·계정·볼륨은 임시로 생성했습니다.

백업 패널에서 다음 두 오류를 실제 Next 프로덕션 서버와 브라우저로 먼저 재현하고 수정했습니다.

- 마지막 청크까지 업로드된 작업에서 상태 조회는 성공하지만 ZIP 조립 요청이 반복 실패하면, 실패 횟수가 매번 초기화되어 무한 재시도가 발생했습니다. 조립 요청까지 성공했을 때만 횟수를 초기화하고, 3회 실패 후 작업 ID를 보존한 채 수동 상태 확인으로 전환합니다.
- 최초 ZIP 조립 요청에는 시간 제한이 없어 응답이 멈추면 후속 상태 조회도 시작되지 않았습니다. 15초 제한 후 저장된 작업 ID로 조회하도록 변경했습니다. 서버에서 완료된 작업은 재업로드 없이 완료 상태를 표시합니다.

검증 결과:

- Node 24.21.0 / npm 12.0.2에서 `npm run verify:source`: 문법·구조·타입 검사 및 Vitest 14개 파일, 126개 테스트 통과.
- `npm run build`: 프로덕션 빌드 통과.
- `npm run test:e2e`: 데스크톱 33개 + 모바일 33개, 총 66개 통과. 추가한 백업 회귀 테스트는 수정 전 2개 실패를 확인했고 수정 후 두 화면 크기에서 통과했습니다. 알라딘 외부 응답과 백업 오류·지연 조건은 fixture로 제어하며, 일반 백업 왕복은 실제 웹·워커·SQLite로 검증합니다.
- Node 22 Docker 이미지 `bookshelf-next:canary-audit-local` 빌드 및 웹·워커 smoke 통과. UID 1001, 공유 DB, 로그인 HTTP 200, 비인증 API 401, DB 무결성 및 외래키 검사 확인.
- 별도 Docker 볼륨에서 실제 워커를 실행하고 두 번째 워커의 종료 코드 1 및 기존 RUNNING 작업 불변 확인. 첫 워커를 SIGKILL로 종료한 뒤 새 워커가 잠금을 획득하고 중단 작업을 FAILED로 복구하는 것 확인.

교체 절차는 Next README에도 반영했습니다. 기존 워커는 새 잠금을 사용하지 않으므로 업데이트 전에 모두 종료해야 합니다. 재고 갱신 시작 시 기존 재고를 지우는 정책과 위 후속 과제는 이번 수정 범위에 포함하지 않습니다.
