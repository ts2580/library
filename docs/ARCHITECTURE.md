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

The web and worker use one repository and one package, but run as different processes. Both mount the same local `data/` volume. SQLite permits multiple readers but only one active write transaction, so external HTTP and image/ZIP processing occur outside application DB write transactions. Claim, state update, and result persistence transactions remain short.

### Aladin public pages (4.0.0)

`features/aladin/client.ts` fetches public HTML without an API key. `html.ts` validates page identity, counts and structure before `service.ts` exposes search results, product metadata and inventory. Unexpected HTML, access denial and incomplete pages fail closed. Product IDs identify selections independently of ISBN; K/U product codes are never saved as ISBNs. Detail lookups verify the edition before registration and run sequentially within each bulk import so large selections do not exhaust the shared gate lock-wait deadline. Metadata enrichment searches all product categories, including foreign books; ISBN candidates without an ISBN in search HTML are hydrated before comparison, with ISBN10/13 normalization. A stored ISBN prevents fallback to another same-title edition.

Web and worker share a maximum of ten in-flight HTML requests. `data/aladin-requests.sqlite` holds the default 1-second start spacing and persistent Retry-After cooldown under short transactions. Ten adjacent `.slot-0` through `.slot-9` SQLite files hold OS-backed locks for admitted requests, including response-body reads; process exit releases slots without expiring a live request. Start spacing is committed around actual callback admission, independently of response time. Successful concurrent requests never clear another request's cooldown. Normal interval and server cooldown are tracked separately so configured intervals up to 60 seconds do not become synthetic 429 errors. Legacy sidecar deadlines are retained during column migration; deadlines beyond the current interval are conservatively treated as cooldowns. These files are independent of application schema version 7 and must not be deleted while either process runs. Both processes must share the same data directory on a local filesystem.

Search results are cached for 5 minutes and product details for 24 hours per process, with request coalescing, 128 entries and an 8 MiB total limit. Selection registration bypasses the search cache. Stock pages always use fresh requests; a 30-second stock cache was not introduced. Product descriptions are optional public-page summaries, and search publication dates retain month precision when no day is supplied.

Stock is collected from every page of the unified used listing (TabType=0). Only Aladin direct shipping and official store offers are retained; marketplace sellers are excluded. All three source filters share this collection. Store rows represent listed online offers with individual purchase links, not all physical copies available for store visits. Pagination, offer uniqueness, seller markers and non-store totals are checked before publishing a result; store tab copy counts can exceed the number of listed offers. Failed or incomplete collection preserves previous inventory.

### Stock refresh

```text
POST /api/stock-refresh
  -> atomically set singleton job QUEUED
worker
  -> claim QUEUED as RUNNING
  -> remove only the requesting owner's locally obsolete inventory
  -> call Aladin outside DB transactions
  -> replace one volume's stock only after a fully verified lookup
  -> rebuild summary and mark COMPLETED/FAILED
GET /api/stock-refresh
  -> poll persisted progress
PATCH /api/stock-refresh { runId }
  -> cancel only the requesting owner's matching QUEUED/RUNNING job
  -> mark CANCELLED, revoke worker lock, rebuild summary and retain saved stock
```

Cancellation fences in-flight lookup results before persistence; the current external request may still finish. A late cancellation cannot cancel a newer run. The inventory panel reports request timeouts, worker failures, partial failures, and progress unchanged for 60 seconds while queued or 120 seconds while running through the error dialog. Delay warnings keep polling and leave cancellation available.

`REPLACE_ALL` preserves each failed volume's prior stock. Only a confirmed empty response clears that volume; failed or partial lookups cannot erase it. Purchased, unneeded or deleted volume rows are removed according to local owner-scoped state. Saved timestamps and the latest lookup failure distinguish retained inventory from newly verified stock.

`POST /api/stock-refresh/retry` accepts `volumeIds` for individual/selected refreshes or `{}` for all unresolved failures. The queue transaction validates the owner's eligible volumes and snapshots them in `stock_refresh_job_target` before the worker claims `REFRESH_SELECTED`. It retains unrelated inventory and failed targets' existing stock; successful results replace only that volume, including clearing it when the lookup confirms no stock. `APPEND_BOOK` keeps its additive behavior, including on empty lookups.

Each attempted volume records a `SUCCESS`, `EMPTY`, or `FAILED` result in `stock_refresh_log`, with an ISBN snapshot, time, error code, and readable reason. Result and stock writes share the worker claim fence. The latest eligible result determines the unresolved failure count, while older failures remain visible in history. `GET /api/stock-refresh/logs` and `/inventory/logs` expose only the requesting administrator's records. Schema version 5 adds the two tables; earlier aggregate failure counts cannot supply historical per-volume reasons.

### Metadata enrichment

`POST /api/books/enrich` snapshots the current user's books with missing book or volume authors/descriptions in `metadata_enrichment_job` (schema version 6). It rejects overlapping requests for the same account; ordinary users can enrich their own books. `GET` returns only that account's progress.

The worker handles one book per iteration between stock and cover jobs. The persisted target list and cursor allow `QUEUED`/`RUNNING` jobs to resume after restart. Public-page lookups occur outside application DB write transactions; metadata is re-read under the write lock so manually entered values remain intact. Batch enrichment leaves purchase links unchanged. Missing results, deleted targets and individual failures do not stop the remaining books.

The profile panel polls active jobs with bounded requests, reports counts and emits a completion toast. Leaving the page does not stop the worker.

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
- `data/aladin-requests.sqlite`: shared HTML request interval and cooldown sidecar.
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

### Stock refresh history (schema 7)

`stock_refresh_run` persists one row per queued run, scoped to its owner. Queue, claim, target count and terminal transitions update this snapshot in the same transaction; completion, failure, cancellation and recovery retain their final timestamps across later jobs. Duration is the elapsed seconds from worker start to finish (or now while running); queue time is excluded and unstarted jobs have no duration. `/inventory/logs` defaults to these run summaries. The `status=failed` view retains unresolved per-volume failures and links to ISBN stock search. A successful/empty lookup clears the volume's failures without adding a success detail row. A repeated failure replaces its earlier details. Schema adoption copies the current job's exact known timestamps; older per-volume data is retained but cannot reconstruct historical run timing.

Stock refresh uses a pool of ten volume lookups. As a volume finishes, the next target starts; pages within each lookup remain sequential. Progress counts each finished volume once regardless of completion order. Cancellation/replacement fences all writes; fatal/rate-limit errors stop new targets. The worker drains in-flight lookups before finalizing the run, so late responses cannot modify a subsequent run. Ordinary per-volume failures preserve that volume's previous stock and allow remaining targets to continue.
