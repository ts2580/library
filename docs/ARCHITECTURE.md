# Bookshelf Next architecture

## Layer rules

| File | Responsibility |
|---|---|
| `queries.ts` | Read-only owner-filtered queries and screen-shaped results. |
| `actions.ts` | Server Action boundary: auth, input extraction/validation, service invocation, revalidation/redirect. |
| `service.ts` | Business rules, writes, short transactions, external I/O orchestration. |
| `validation.ts` | Zod schemas for untrusted input. |
| `types.ts` | Shared feature types only; Drizzle-inferred types are not duplicated. |

Server Components call `queries.ts` directly. They do not call this application's Route Handlers through HTTP. Route Handlers exist for browser polling, file transfer, raw chunk upload, and external-style JSON endpoints.

## Process model

```text
Browser -> Next.js web process -> SQLite/WAL
                 |                  ^
                 | queue/status     |
                 v                  |
             Route Handler      worker process
                                     |
                              Aladin / ZIP restore
```

The web and worker use one repository and one package, but run as different processes. Both mount the same local `data/` volume. SQLite permits multiple readers but only one active write transaction, so external HTTP and image/ZIP processing occur outside write transactions. Claim, state update, and result persistence transactions remain short.

### Stock refresh

```text
POST /api/stock-refresh
  -> atomically set singleton job QUEUED
worker
  -> claim QUEUED as RUNNING
  -> clear requesting owner's prior inventory
  -> call Aladin outside DB transactions
  -> replace one volume's stock in a short transaction
  -> rebuild summary and mark COMPLETED/FAILED
GET /api/stock-refresh
  -> poll persisted progress
PATCH /api/stock-refresh { runId }
  -> cancel only the requesting owner's matching QUEUED/RUNNING job
  -> mark CANCELLED, revoke worker lock, rebuild summary and retain saved stock
```

Cancellation fences in-flight lookup results before persistence; the current external request may still finish. A late cancellation cannot cancel a newer run. The inventory panel reports request timeouts, worker failures, partial failures, and progress unchanged for 60 seconds while queued or 120 seconds while running through the error dialog. Delay warnings keep polling and leave cancellation available.

### Cover archive restore

```text
create upload -> upload 8MiB chunks -> ASSEMBLING -> QUEUED
worker -> PROCESSING -> safe ZIP validation/restore -> COMPLETED or FAILED
```

`ASSEMBLING` belongs to the web process and is distinct from worker-owned `PROCESSING`, preventing worker restart recovery from incorrectly failing a currently assembling upload.

The web process updates the assembly heartbeat after each chunk. Every 30 seconds the worker expires assemblies with no heartbeat for 15 minutes, independently of inventory processing. This periodic recovery leaves live `PROCESSING` jobs alone. Failed assembly/restore files are removed while retaining the job status; any failed files that cannot be removed still count toward the owner's two-job and 2GiB upload reservations.

Multipart Excel and manual-cover routes limit the raw incoming stream before parsing form data. The 32MiB workbook and 8MiB cover limits each allow an additional 64KiB for multipart metadata; file validation still applies after parsing.

## Runtime data

- `data/bookshelf.sqlite`: SQLite database.
- `data/covers/`: authenticated runtime cover files.
- `data/uploads/`: chunked ZIP upload staging.
- `data/backups/`: pre-bootstrap database copies.
- `public/`: deployment-time static files only.

New cover references use `cover://<ownerId>/<filename>`. Legacy `/covers/<filename>` references remain readable during migration. `/api/covers/[...path]` verifies both ownership and the resolved filesystem boundary before streaming a file.

## Authorization

- `(app)/layout.tsx` provides the shared shell and redirects anonymous navigation.
- Every Server Action and Route Handler authenticates independently.
- Object authorization is enforced again in SQL with `owner_id` conditions.
- Cover delivery verifies that the requested reference belongs to the current account.
- Unknown internal errors are logged but are not returned to the browser.

## Database adoption

`db/bootstrap.ts` is the cutover adapter for existing SQLite databases. It:

1. Creates a one-time pre-bootstrap copy.
2. Creates missing tables for a new database.
3. Adds missing legacy columns conditionally.
4. Assigns ownerless books only to the explicitly configured existing `BOOKSHELF_LEGACY_OWNER_USERNAME`; otherwise rolls back.
5. Backfills `branchbook.book_volume_id` only when `(book, volume)` resolves to exactly one volume.
6. Enables foreign keys, WAL, a 5-second busy timeout, and normal synchronous mode.

The SQL file under `db/migrations/` is a non-destructive baseline marker. Future schema changes should be generated into `drizzle/` after the target database has been baselined.

Existing adoption is tracked separately in `bookshelf_migrations`. Its SQL marker is not a generated Drizzle migration. Before introducing generated migrations, baseline a copy of the adopted DB and inspect the SQL; do not apply a generated CREATE-all migration to the existing database.

Connections are lazy, including during `next build`. Web, worker, and migration CLI load the same environment files. Registration defaults to disabled. Inventory pages and stock APIs retain the legacy administrator boundary, in addition to owner-scoped SQL.
