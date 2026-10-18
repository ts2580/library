# Spring Boot to Next.js migration

Java sources and the one-click runner are retained in v3.0.0-ca2, not in the ca3 source tree. The published ca2 migration image supports one-click snapshot, cover copy, schema adoption and managed Next web/worker startup. See [the Korean operator guide](ONE_CLICK_MIGRATION.md) for installation and recovery. The manual procedure below remains available.

## Existing database

1. Stop the Java web process and any background process that can write SQLite.
2. After a clean Java shutdown, back up the database and matching covers directory. For a running read-only rehearsal, use SQLite's online backup API/CLI rather than copying an active database and its WAL independently.
3. Put the database at `data/bookshelf.sqlite` in this project.
4. Copy legacy cover files into `data/covers/`.
5. Set `BOOKSHELF_LEGACY_OWNER_USERNAME` to the account that should own rows from a database without `books.owner_id`.
6. Run `npm run db:migrate`.
7. Review `npm run db:verify` before starting the web and worker processes.

The first database query creates a consistent `VACUUM INTO` snapshot in `data/backups/pre-next-bootstrap-*.sqlite`, conditionally upgrades the schema, and records version/backup path in `bookshelf_migrations` inside the migration transaction. Importing modules during a build does not open the runtime database. Backup failure stops migration.

Ownerless books require an existing `BOOKSHELF_LEGACY_OWNER_USERNAME`; migration never substitutes the first account. The default `trstyq` matches the legacy administrator convention. Role adoption happens once. `book_volumes.volume` remains the canonical volume number; legacy `seq` is retained as data. `branchbook.book_volume_id` is filled only for an exact, unique `(book, volume)` match; fractional or ambiguous legacy rows stay unlinked.

The old Spring `persistent_logins` table is retained for rollback but is never trusted by the new application. Existing remember-me cookies stop working. Users sign in again; a successful login upgrades a legacy 64-character SHA-256 password hash to BCrypt.

## Cutover

```bash
cp .env.example .env
npm ci
npm run check:syntax
npm run check:structure
npm run db:migrate
npm run db:verify
npm run typecheck
npm test
npm run build
npm run start        # process 1
npm run worker       # process 2
```

Do not run Java and Next.js against the same writable SQLite database. SQLite WAL requires the web and worker to use the same host-local filesystem; do not share this database between hosts through NFS or an object-storage mount.

Run from the repository root. Move old local `next/data/` into the root `data/` before starting, preserving Java originals and logs under `data/legacy/`; see [the relocation steps](ONE_CLICK_MIGRATION.md). The application reads the active handover pointer only from the configured data root: local `data/` or Docker `/data`. Both Next development and production use port `25647`; stop the existing Java listener before starting Next directly. The ca2 Spring handover starts Next on `25648` while Java remains on `25647`. `data/migration-check/` contains the isolated rehearsal copy. Configure both web and worker with that directory when reviewing the copied data.

Run one worker per database. The worker takes an exclusive SQLite lock before recovery; a second worker fails before changing running jobs. Stop old workers before upgrading from releases without that lock.

## Docker

Both services must share exactly the same data volume. Existing installations use `docker-compose.release.yml` with their external volume names; the default command below is for a new installation:

```bash
docker compose up -d --build
```

For a bind mount, replace the named volume in **both** services with `./data:/data` and ensure UID/GID `1001:1001` can write it.

## Rollback

1. Stop the Next.js web and worker processes.
2. Preserve the migrated database for investigation.
3. Restore the pre-bootstrap database copy and matching covers directory.
4. Restart only the Java application.

Because the new app preserves legacy table and column names, rollback may also work against the migrated DB, but restoring the recorded pre-bootstrap copy is the deterministic path.
