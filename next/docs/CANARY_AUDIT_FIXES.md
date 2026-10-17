# Canary audit fixes

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

## Validation in this editing environment

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
