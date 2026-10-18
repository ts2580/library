import "server-only";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const BOOTSTRAP_VERSION = 4;

type Database = BetterSqlite3.Database;

function tableExists(sqlite: Database, table: string): boolean {
  const row = sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { ok?: number } | undefined;
  return row?.ok === 1;
}

function columnExists(sqlite: Database, table: string, column: string): boolean {
  if (!tableExists(sqlite, table)) return false;
  const columns = sqlite.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{ name: string }>;
  return columns.some((item) => item.name === column);
}

function ensureColumn(sqlite: Database, table: string, definition: string): void {
  const column = definition.trim().split(/\s+/)[0]?.replaceAll('"', "");
  if (!column || columnExists(sqlite, table, column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function backupBeforeUpgrade(sqlite: Database): string | null {
  if (!env.BOOKSHELF_AUTO_BACKUP || sqlite.name === ":memory:" || !fs.existsSync(sqlite.name)) return null;
  const objectCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type IN ('table', 'view')").get() as { count: number }).count;
  if (objectCount === 0) return null;
  fs.mkdirSync(env.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(env.backupsDir, `pre-next-bootstrap-${stamp}.sqlite`);
  const quotedTarget = target.replaceAll("'", "''");
  // VACUUM INTO produces a consistent snapshot, including committed WAL data.
  // A failed backup must stop migration; copying an active main file is unsafe.
  sqlite.exec(`VACUUM INTO '${quotedTarget}'`);
  return target;
}

function createBaseline(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      name TEXT,
      description TEXT,
      role TEXT NOT NULL DEFAULT 'USER'
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      totalvolume TEXT,
      description TEXT,
      sync TEXT,
      type TEXT,
      name TEXT,
      cover TEXT,
      isdeleted INTEGER,
      systemmodstamp TEXT,
      order_no TEXT,
      createddate TEXT DEFAULT CURRENT_TIMESTAMP,
      author TEXT,
      createdbyid TEXT,
      encrypt TEXT,
      sfid TEXT,
      hc_lastop TEXT,
      hc_err TEXT,
      owner_id INTEGER,
      cover_generated INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (owner_id) REFERENCES member (id) ON DELETE RESTRICT ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_categories (
      name TEXT PRIMARY KEY,
      createddate TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS persistent_logins (
      username TEXT NOT NULL,
      series TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      last_used TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS book_volumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seq INTEGER,
      book INTEGER NOT NULL,
      cover TEXT,
      originalUrl TEXT,
      isbn13 TEXT,
      price TEXT,
      ispurchased INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      type TEXT,
      volume INTEGER,
      noneedtobuy INTEGER DEFAULT 0,
      isbn TEXT,
      description TEXT,
      link TEXT,
      pubdate TEXT,
      createddate TEXT,
      author TEXT,
      cover_generated INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (book) REFERENCES books (id) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branchbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booklink TEXT,
      purchaseurl TEXT,
      branch TEXT,
      uuid TEXT UNIQUE,
      volume REAL,
      name TEXT,
      price TEXT,
      branchname TEXT,
      grade TEXT,
      createddate TEXT DEFAULT CURRENT_TIMESTAMP,
      book INTEGER,
      book_volume_id INTEGER,
      systemmodstamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book) REFERENCES books (id) ON DELETE CASCADE,
      FOREIGN KEY (book_volume_id) REFERENCES book_volumes (id) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branch_inventory_summary (
      branch TEXT NOT NULL PRIMARY KEY,
      branch_name TEXT NOT NULL,
      stock_count INTEGER NOT NULL DEFAULT 0,
      priced_count INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_refresh_job (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      running INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 0,
      empty INTEGER NOT NULL DEFAULT 0,
      fail INTEGER NOT NULL DEFAULT 0,
      percent INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      updated_at TEXT,
      status TEXT NOT NULL DEFAULT 'IDLE',
      requested_by INTEGER,
      lock_token TEXT,
      started_at TEXT,
      finished_at TEXT,
      heartbeat_at TEXT,
      FOREIGN KEY (requested_by) REFERENCES member(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS app_sessions (
      id_hash TEXT PRIMARY KEY,
      member_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_agent_hash TEXT,
      FOREIGN KEY (member_id) REFERENCES member(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS backup_upload_job (
      upload_id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      total_size INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      uploaded_chunks INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'UPLOADING',
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      lock_token TEXT,
      FOREIGN KEY (owner_id) REFERENCES member(id) ON DELETE CASCADE
    );
  `);
}

function upgradeLegacySchema(sqlite: Database): void {
  ensureColumn(sqlite, "member", "role TEXT NOT NULL DEFAULT 'USER'");
  ensureColumn(sqlite, "books", "owner_id INTEGER REFERENCES member(id) ON DELETE RESTRICT ON UPDATE CASCADE");
  ensureColumn(sqlite, "books", "cover_generated INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "book_volumes", "cover_generated INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "branchbook", "book_volume_id INTEGER REFERENCES book_volumes(id) ON DELETE CASCADE ON UPDATE CASCADE");

  ensureColumn(sqlite, "stock_refresh_job", "status TEXT NOT NULL DEFAULT 'IDLE'");
  ensureColumn(sqlite, "stock_refresh_job", "requested_by INTEGER REFERENCES member(id) ON DELETE SET NULL");
  ensureColumn(sqlite, "stock_refresh_job", "lock_token TEXT");
  ensureColumn(sqlite, "stock_refresh_job", "started_at TEXT");
  ensureColumn(sqlite, "stock_refresh_job", "finished_at TEXT");
  ensureColumn(sqlite, "stock_refresh_job", "heartbeat_at TEXT");

  const owner = sqlite.prepare("SELECT id FROM member WHERE username = ? COLLATE NOCASE LIMIT 1")
    .get(env.BOOKSHELF_LEGACY_OWNER_USERNAME) as { id: number } | undefined;
  const ownerless = sqlite.prepare("SELECT COUNT(*) AS count FROM books WHERE owner_id IS NULL").get() as { count: number };
  if (!owner && ownerless.count > 0) {
    throw new Error("Ownerless books exist. Set BOOKSHELF_LEGACY_OWNER_USERNAME to an existing account before migration.");
  }
  if (owner) {
    sqlite.prepare("UPDATE books SET owner_id = ? WHERE owner_id IS NULL").run(owner.id);
    sqlite.prepare("UPDATE member SET role = 'ADMIN' WHERE id = ? AND role = 'USER'").run(owner.id);
  }

  const candidates = sqlite.prepare(`
    SELECT bb.id AS branchBookId, MIN(bv.id) AS volumeId, COUNT(bv.id) AS matchCount
    FROM branchbook bb
    JOIN book_volumes bv
      ON bv.book = bb.book
     AND bv.volume = bb.volume
    WHERE bb.book_volume_id IS NULL
    GROUP BY bb.id
    HAVING COUNT(bv.id) = 1
  `).all() as Array<{ branchBookId: number; volumeId: number; matchCount: number }>;
  const update = sqlite.prepare("UPDATE branchbook SET book_volume_id = ? WHERE id = ? AND book_volume_id IS NULL");
  for (const row of candidates) update.run(row.volumeId, row.branchBookId);
}

function createIndexesAndSeed(sqlite: Database): void {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_books_name ON books(name);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
    CREATE INDEX IF NOT EXISTS idx_books_type ON books(type);
    CREATE INDEX IF NOT EXISTS idx_books_type_id ON books(type, id);
    CREATE INDEX IF NOT EXISTS idx_books_owner_id ON books(owner_id);
    CREATE INDEX IF NOT EXISTS idx_book_volumes_book ON book_volumes(book);
    CREATE INDEX IF NOT EXISTS idx_book_volumes_book_volume ON book_volumes(book, volume);
    CREATE INDEX IF NOT EXISTS idx_book_volumes_isbn13 ON book_volumes(isbn13);
    CREATE INDEX IF NOT EXISTS idx_book_volumes_ispurchased ON book_volumes(ispurchased);
    CREATE INDEX IF NOT EXISTS idx_book_volumes_stock_refresh_target ON book_volumes(ispurchased, noneedtobuy, id);
    CREATE INDEX IF NOT EXISTS idx_book_volumes_createddate ON book_volumes(createddate);
    CREATE INDEX IF NOT EXISTS idx_branchbook_book ON branchbook(book);
    CREATE INDEX IF NOT EXISTS idx_branchbook_branch ON branchbook(branch);
    CREATE INDEX IF NOT EXISTS idx_branchbook_book_volume ON branchbook(book, volume);
    CREATE INDEX IF NOT EXISTS idx_branchbook_book_volume_id ON branchbook(book_volume_id);
    CREATE INDEX IF NOT EXISTS idx_branch_inventory_summary_total_amount ON branch_inventory_summary(total_amount);
    CREATE INDEX IF NOT EXISTS idx_branch_inventory_summary_updated_at ON branch_inventory_summary(updated_at);
    CREATE INDEX IF NOT EXISTS idx_app_sessions_member ON app_sessions(member_id);
    CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON app_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_backup_upload_owner ON backup_upload_job(owner_id);
    CREATE INDEX IF NOT EXISTS idx_backup_upload_status ON backup_upload_job(status);

    INSERT OR IGNORE INTO book_categories(name)
      SELECT DISTINCT TRIM(type) FROM books WHERE type IS NOT NULL AND TRIM(type) <> '';

    INSERT OR IGNORE INTO stock_refresh_job(
      id, running, completed, failed, total, processed, success, empty, fail, percent, message, updated_at, status
    ) VALUES (
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, '아직 실행한 일괄 갱신 작업이 없습니다.', CURRENT_TIMESTAMP, 'IDLE'
    );
  `);
}

export function bootstrapDatabase(sqlite: Database): void {
  sqlite.function("normalize_nfc", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? value.normalize("NFC") : value == null ? "" : String(value));
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.mkdirSync(env.coversDir, { recursive: true });
  fs.mkdirSync(env.uploadsDir, { recursive: true });
  fs.mkdirSync(env.backupsDir, { recursive: true });

  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");

  function isApplied(version = BOOTSTRAP_VERSION): boolean {
    return tableExists(sqlite, "bookshelf_migrations") && Boolean(sqlite.prepare(
      "SELECT 1 FROM bookshelf_migrations WHERE version = ?"
    ).get(version));
  }
  if (isApplied()) return;
  const backup = backupBeforeUpgrade(sqlite);

  const transaction = sqlite.transaction(() => {
    if (isApplied()) return;
    if (!isApplied(1)) {
      createBaseline(sqlite);
      upgradeLegacySchema(sqlite);
      createIndexesAndSeed(sqlite);
      sqlite.exec("CREATE TABLE IF NOT EXISTS bookshelf_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, backup_path TEXT)");
      sqlite.prepare("INSERT INTO bookshelf_migrations(version, applied_at, backup_path) VALUES (1, ?, ?)")
        .run(new Date().toISOString(), backup);
    }
    // Version 2 only adds job scope metadata; never re-run legacy data or role adoption.
    if (!isApplied(2)) {
      ensureColumn(sqlite, "stock_refresh_job", "mode TEXT NOT NULL DEFAULT 'REPLACE_ALL'");
      ensureColumn(sqlite, "stock_refresh_job", "scope_book_id INTEGER REFERENCES books(id) ON DELETE SET NULL");
      sqlite.prepare("INSERT INTO bookshelf_migrations(version, applied_at, backup_path) VALUES (2, ?, ?)")
        .run(new Date().toISOString(), backup);
    }
    if (!isApplied(3)) {
      ensureColumn(sqlite, "stock_refresh_job", "run_id TEXT");
      sqlite.prepare("INSERT INTO bookshelf_migrations(version, applied_at, backup_path) VALUES (3, ?, ?)")
        .run(new Date().toISOString(), backup);
    }
    sqlite.exec(`CREATE TABLE IF NOT EXISTS stock_refresh_completion (
      owner_id INTEGER PRIMARY KEY REFERENCES member(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL
    )`);
    sqlite.exec(`INSERT OR IGNORE INTO stock_refresh_completion(owner_id, run_id)
      SELECT requested_by, run_id FROM stock_refresh_job
      WHERE requested_by IS NOT NULL AND run_id IS NOT NULL AND status IN ('COMPLETED','FAILED')`);
    sqlite.prepare("INSERT INTO bookshelf_migrations(version, applied_at, backup_path) VALUES (4, ?, ?)")
      .run(new Date().toISOString(), backup);
  });
  transaction.immediate();

  logger.info("SQLite bootstrap complete", { databasePath: env.databasePath, version: BOOTSTRAP_VERSION });
}
