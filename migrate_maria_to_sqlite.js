const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
const BATCH_SIZE = 1000;

function parseEnvFile(filePath = path.join(ROOT, '.env')) {
  const env = {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) continue;
      const idx = raw.indexOf('=');
      if (idx <= 0) continue;
      env[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Missing .env is fine; process.env can carry all required values.
  }
  return env;
}

function parseMariaJdbc(url) {
  if (!url) return null;
  const u = String(url).replace(/^jdbc:/i, '');
  const m = u.match(/^mariadb:\/\/([^:/?#]+)(?::(\d+))?(?:\/([^?]+))?/i);
  if (!m) return null;
  return {
    host: m[1],
    port: Number(m[2] || 3306),
    database: decodeURIComponent((m[3] || 'bookshelf').replace(/\?.*$/, '')),
  };
}

function parseSqliteJdbc(url) {
  if (!url) return null;
  const m = String(url).match(/^jdbc:sqlite:(.+?)(?:\?.*)?$/i);
  return m ? m[1] : null;
}

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function sourceConfig(env) {
  const url = pick(
    process.env.MARIA_DB_URL,
    process.env.MARIADB_DB_URL,
    env.MARIA_DB_URL,
    env.MARIADB_DB_URL,
    String(process.env.BOOKSHELF_DB_URL || env.BOOKSHELF_DB_URL || '').includes('mariadb:')
      ? pick(process.env.BOOKSHELF_DB_URL, env.BOOKSHELF_DB_URL)
      : null,
    process.env.DB_URL,
    env.DB_URL
  );
  const parsed = parseMariaJdbc(url);
  if (!parsed) {
    throw new Error('MariaDB source URL is required. Set MARIA_DB_URL or keep a MariaDB BOOKSHELF_DB_URL in .env.');
  }
  return {
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    user: pick(process.env.MARIA_DB_USERNAME, process.env.MARIADB_DB_USERNAME, env.MARIA_DB_USERNAME, env.MARIADB_DB_USERNAME, process.env.BOOKSHELF_DB_USERNAME, env.BOOKSHELF_DB_USERNAME, process.env.DB_USERNAME, env.DB_USERNAME, 'bookshelf'),
    password: pick(process.env.MARIA_DB_PASSWORD, process.env.MARIADB_DB_PASSWORD, env.MARIA_DB_PASSWORD, env.MARIADB_DB_PASSWORD, process.env.BOOKSHELF_DB_PASSWORD, env.BOOKSHELF_DB_PASSWORD, process.env.DB_PASSWORD, env.DB_PASSWORD, ''),
  };
}

function targetSqlitePath(env) {
  const argPath = process.argv[2];
  const fromUrl = parseSqliteJdbc(pick(process.env.BOOKSHELF_DB_URL, env.BOOKSHELF_DB_URL));
  const selected = pick(argPath, process.env.SQLITE_DB_PATH, env.SQLITE_DB_PATH, process.env.BOOKSHELF_DB_PATH, env.BOOKSHELF_DB_PATH, fromUrl, './bookshelf.sqlite');
  return path.resolve(ROOT, selected);
}

function sqlIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query('SHOW TABLES LIKE ?', [table]);
  return rows.length > 0;
}

async function sourceColumns(conn, table) {
  if (!(await tableExists(conn, table))) return new Set();
  const [rows] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
  return new Set(rows.map((row) => row.Field));
}

function selectSql(table, targetColumns, availableColumns) {
  const select = targetColumns.map((column) => {
    if (availableColumns.has(column)) return `\`${column}\` AS \`${column}\``;
    return `NULL AS \`${column}\``;
  });
  const orderColumn = availableColumns.has('id') ? 'id' : targetColumns.find((column) => availableColumns.has(column));
  const orderBy = orderColumn ? ` ORDER BY \`${orderColumn}\` ASC` : '';
  return `SELECT ${select.join(', ')} FROM \`${table}\`${orderBy}`;
}

async function fetchRows(conn, table, columns, limit, offset) {
  const available = await sourceColumns(conn, table);
  if (!available.size) return { rows: [], available };
  const [rows] = await conn.query(`${selectSql(table, columns, available)} LIMIT ? OFFSET ?`, [limit, offset]);
  return { rows, available };
}

function appendInserts(sqlFile, table, columns, rows) {
  if (!rows.length) return 0;
  const insertPrefix = `INSERT INTO ${sqlIdent(table)} (${columns.map(sqlIdent).join(', ')}) VALUES `;
  const lines = [];
  for (const row of rows) {
    const values = columns.map((column) => sqlValue(row[column]));
    lines.push(`${insertPrefix}(${values.join(', ')});`);
  }
  fs.appendFileSync(sqlFile, `${lines.join('\n')}\n`);
  return rows.length;
}

async function appendTableInserts(conn, sqlFile, table, columns) {
  let offset = 0;
  let count = 0;
  let available = null;

  while (true) {
    const result = available
      ? await conn.query(`${selectSql(table, columns, available)} LIMIT ? OFFSET ?`, [BATCH_SIZE, offset]).then(([rows]) => ({ rows, available }))
      : await fetchRows(conn, table, columns, BATCH_SIZE, offset);

    available = result.available;
    if (!available.size || result.rows.length === 0) return count;

    count += appendInserts(sqlFile, table, columns, result.rows);
    offset += result.rows.length;
  }
}

async function queryCount(conn, sql) {
  const [rows] = await conn.query(sql);
  const first = rows[0] || {};
  return Number(first.count || 0);
}

async function validateSourceData(conn) {
  const issues = [];

  if (await tableExists(conn, 'book_volumes')) {
    const nullBookCount = await queryCount(conn, 'SELECT COUNT(*) AS count FROM book_volumes WHERE book IS NULL');
    if (nullBookCount > 0) {
      issues.push(`book_volumes rows with NULL book: ${nullBookCount}`);
    }

    if (await tableExists(conn, 'books')) {
      const orphanVolumeCount = await queryCount(conn, `
        SELECT COUNT(*) AS count
        FROM book_volumes bv
        LEFT JOIN books b ON b.id = bv.book
        WHERE bv.book IS NOT NULL AND b.id IS NULL
      `);
      if (orphanVolumeCount > 0) {
        issues.push(`book_volumes rows referencing missing books: ${orphanVolumeCount}`);
      }
    }
  }

  if ((await tableExists(conn, 'branchbook')) && (await tableExists(conn, 'books'))) {
    const orphanBranchBookCount = await queryCount(conn, `
      SELECT COUNT(*) AS count
      FROM branchbook bb
      LEFT JOIN books b ON b.id = bb.book
      WHERE bb.book IS NOT NULL AND b.id IS NULL
    `);
    if (orphanBranchBookCount > 0) {
      issues.push(`branchbook rows referencing missing books: ${orphanBranchBookCount}`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`MariaDB source data violates SQLite foreign key constraints:\n${issues.join('\n')}`);
  }
}

async function main() {
  const env = parseEnvFile();
  const cfg = sourceConfig(env);
  const sqlitePath = targetSqlitePath(env);
  const sqlScriptPath = path.join('/tmp', `bookshelf-maria-to-sqlite-${process.pid}.sql`);
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    dateStrings: true,
  });

  const columns = {
    books: ['id', 'totalvolume', 'description', 'sync', 'type', 'name', 'cover', 'isdeleted', 'systemmodstamp', 'order_no', 'createddate', 'author', 'createdbyid', 'encrypt', 'sfid', 'hc_lastop', 'hc_err'],
    member: ['id', 'username', 'password_hash', 'email', 'name', 'description'],
    book_volumes: ['id', 'seq', 'book', 'cover', 'isbn13', 'price', 'ispurchased', 'name', 'type', 'volume', 'noneedtobuy', 'isbn', 'description', 'link', 'pubdate', 'createddate', 'author'],
    branchbook: ['id', 'booklink', 'purchaseurl', 'branch', 'uuid', 'volume', 'name', 'price', 'branchname', 'grade', 'createddate', 'book', 'systemmodstamp'],
    branch_inventory_summary: ['branch', 'branch_name', 'stock_count', 'priced_count', 'total_amount', 'updated_at'],
  };

  try {
    await validateSourceData(conn);

    fs.writeFileSync(sqlScriptPath, [
      fs.readFileSync(path.join(ROOT, 'src/main/resources/schema.sql'), 'utf8').trim(),
      'PRAGMA foreign_keys = OFF;',
      'BEGIN TRANSACTION;',
      'DELETE FROM branch_inventory_summary;',
      'DELETE FROM branchbook;',
      'DELETE FROM book_volumes;',
      'DELETE FROM member;',
      'DELETE FROM books;',
      '',
    ].join('\n'));

    const counts = {};
    for (const table of Object.keys(columns)) {
      counts[table] = await appendTableInserts(conn, sqlScriptPath, table, columns[table]);
    }

    fs.appendFileSync(sqlScriptPath, 'COMMIT;\nPRAGMA foreign_keys = ON;\nPRAGMA foreign_key_check;\n');

    const result = spawnSync('sqlite3', ['-batch', sqlitePath], {
      input: `.read ${sqlScriptPath}\n`,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });

    if (result.status !== 0) {
      throw new Error(`sqlite3 failed: ${result.stderr || result.stdout}`);
    }
    if (result.stdout && result.stdout.trim() !== '') {
      throw new Error(`SQLite foreign key check failed:\n${result.stdout.trim()}`);
    }

    console.log(`Migration done: ${sqlitePath}`);
    for (const table of Object.keys(columns)) {
      console.log(`${table}=${counts[table]}`);
    }
  } finally {
    await conn.end().catch(() => {});
    fs.rmSync(sqlScriptPath, { force: true });
  }
}

main().catch((err) => {
  console.error(`Migration failed: ${err.message || err}`);
  process.exit(1);
});
