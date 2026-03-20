const { Client } = require('pg');
const mysql = require('mysql2/promise');
const fs = require('fs');

function parseEnvFile(filePath = '/home/trstyq/code/bookshelf/.env') {
  const env = {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) continue;
      const idx = raw.indexOf('=');
      if (idx <= 0) continue;
      env[raw.slice(0, idx)] = raw.slice(idx + 1);
    }
  } catch {
    // env file unavailable; rely on process env.
  }
  return env;
}

function parseJdbc(url, fallbackPort, fallbackDb = null) {
  if (!url) return null;
  const u = String(url).replace(/^jdbc:/i, '');
  const m = u.match(/^(?:postgres(?:ql)?:\/\/|mariadb:\/\/)([^:/?#]+)(?::(\d+))?(?:\/([^?]+))?/i);
  if (!m) return null;
  return {
    host: m[1],
    port: Number(m[2] || fallbackPort),
    database: (m[3] || fallbackDb || '').replace(/\?.*$/, ''),
  };
}

function getConfig() {
  const env = parseEnvFile();

  const pgParsed = parseJdbc(process.env.PG_DB_URL || process.env.DB_URL, 5432, process.env.PG_DATABASE || process.env.DATABASE)
    || parseJdbc(env.PG_DB_URL || env.DB_URL, 5432, env.PG_DATABASE || env.DATABASE);

  const mariaParsed = parseJdbc(process.env.BOOKSHELF_DB_URL || process.env.DB_URL, 3306, process.env.BOOKSHELF_DB_DATABASE || process.env.DATABASE)
    || parseJdbc(env.BOOKSHELF_DB_URL || env.DB_URL, 3306, env.BOOKSHELF_DB_DATABASE || env.DATABASE);

  return {
    pg: {
      host: pgParsed?.host || process.env.PG_HOST || env.DB_HOST || 'localhost',
      port: pgParsed?.port || Number(process.env.PG_PORT || env.DB_PORT || 5432),
      database: pgParsed?.database || process.env.PG_DATABASE || env.PG_DATABASE || env.DATABASE || 'postgres',
      user: process.env.PG_USERNAME || env.DB_USERNAME || 'postgres',
      password: process.env.PG_PASSWORD || env.DB_PASSWORD || '',
    },
    maria: {
      host: mariaParsed?.host || process.env.BOOKSHELF_DB_HOST || env.BOOKSHELF_DB_HOST || 'localhost',
      port: Number(mariaParsed?.port || process.env.BOOKSHELF_DB_PORT || env.BOOKSHELF_DB_PORT || 3306),
      database: mariaParsed?.database || process.env.BOOKSHELF_DB_DATABASE || env.BOOKSHELF_DB_DATABASE || env.DATABASE || 'bookshelf',
      user: process.env.BOOKSHELF_DB_USERNAME || env.BOOKSHELF_DB_USERNAME || env.DB_USERNAME || 'root',
      password: process.env.BOOKSHELF_DB_PASSWORD || env.BOOKSHELF_DB_PASSWORD || env.DB_PASSWORD || '',
    },
  };
}

(async () => {
  const cfg = getConfig();

  const pg = new Client({
    host: cfg.pg.host,
    port: cfg.pg.port,
    database: cfg.pg.database,
    user: cfg.pg.user,
    password: cfg.pg.password,
    ssl: { rejectUnauthorized: false },
  });

  const maria = await mysql.createConnection({
    host: cfg.maria.host,
    port: cfg.maria.port,
    user: cfg.maria.user,
    password: cfg.maria.password,
    database: cfg.maria.database,
    multipleStatements: true,
  });

  try {
    await pg.connect();
    const { rows } = await pg.query(
      "SELECT isbn13, max(pubdate) AS created_date FROM devext.bookbyvolume WHERE isbn13 IS NOT NULL GROUP BY isbn13"
    );

    const list = rows
      .map((r) => [String(r.isbn13 || '').trim(), r.created_date])
      .filter(([isbn, created]) => isbn && created);

    if (!list.length) {
      console.log('No source rows to apply.');
      return;
    }

    await maria.query('ALTER TABLE book_volumes ADD COLUMN IF NOT EXISTS createddate DATETIME NULL');
    await maria.query('CREATE INDEX IF NOT EXISTS idx_book_volumes_createddate ON book_volumes (createddate)');
    await maria.query('CREATE TEMPORARY TABLE IF NOT EXISTS tmp_bv_createddate (isbn13 VARCHAR(20) PRIMARY KEY, createddate DATETIME)');
    await maria.query('TRUNCATE TABLE tmp_bv_createddate');

    const chunkSize = 400;
    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?, ?)').join(',');
      const params = chunk.flatMap(([isbn, created]) => [isbn, new Date(created)]);
      await maria.query(`INSERT INTO tmp_bv_createddate (isbn13, createddate) VALUES ${placeholders}`, params);
    }

    const [updateResult] = await maria.query(`UPDATE book_volumes bv
                                           JOIN tmp_bv_createddate t ON bv.isbn13 = t.isbn13
                                           SET bv.createddate = t.createddate`);

    const [[{ matched }]] = await maria.query(`SELECT COUNT(*) AS matched
                                               FROM book_volumes bv
                                               JOIN tmp_bv_createddate t ON bv.isbn13 = t.isbn13`);
    const [[{ nullCount }]] = await maria.query(`SELECT COUNT(*) AS nullCount FROM book_volumes WHERE createddate IS NULL`);

    console.log(`sourced=${list.length}`);
    console.log(`updated=${updateResult?.affectedRows || 0}`);
    console.log(`matched=${matched}`);
    console.log(`nullCreatedCount=${nullCount}`);
  } finally {
    await pg.end().catch(() => {});
    await maria.end().catch(() => {});
  }
})();
