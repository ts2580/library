const fs = require('fs');
const { Client } = require('pg');
const mysql = require('mysql2/promise');

function parseEnv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx <= 0) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

function stripPrefixJdbc(url) {
  return url.replace(/^jdbc:/i, '');
}

function parsePgUrl(url) {
  const u = stripPrefixJdbc(url);
  const m = u.match(/^postgresql:\/\/([^:/?#]+)(?::(\d+))?(\/[^?]+)?(?:\?.*)?$/);
  if (!m) {
    throw new Error(`Invalid PostgreSQL URL: ${url}`);
  }
  return { host: m[1], port: Number(m[2] || 5432), database: decodeURIComponent((m[3] || '/').replace(/^\//, '')) };
}

function parseMariaUrl(url) {
  const u = url.replace(/^jdbc:/i, '');
  const m = u.match(/^mariadb:\/\/([^:/?#]+)(?::(\d+))?(\/[^?]+)?(?:\?.*)?$/);
  if (!m) {
    throw new Error(`Invalid MariaDB URL: ${url}`);
  }
  return { host: m[1], port: Number(m[2] || 3306), database: decodeURIComponent((m[3] || '/').replace(/^\//, '')) };
}

const toValue = (v) => (v === null || v === undefined ? null : v instanceof Date ? v : v);
const toBool = (v) => (v === null || v === undefined ? null : (v ? 1 : 0));

async function main() {
  const pgEnv = parseEnv('/home/trstyq/code/bookshelf/.env');
  const mariaEnv = parseEnv('/home/trstyq/code/etl-platform/.env');

  const pgInfo = parsePgUrl(pgEnv.DB_URL);
  const mariaInfo = parseMariaUrl(mariaEnv.DB_URL);

  const pg = new Client({
    host: pgInfo.host,
    port: pgInfo.port,
    database: pgInfo.database,
    user: pgEnv.DB_USERNAME,
    password: pgEnv.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  const maria = await mysql.createConnection({
    host: mariaInfo.host,
    port: mariaInfo.port,
    user: mariaEnv.DB_USERNAME,
    password: mariaEnv.DB_PASSWORD,
    multipleStatements: true,
  });

  try {
    await pg.connect();
    await pg.query('SELECT 1');
    console.log('Connected to PostgreSQL');

    await maria.query('CREATE SCHEMA IF NOT EXISTS bookshelf CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;');
    await maria.query('USE bookshelf;');

    await maria.query('DROP TABLE IF EXISTS book_volumes;');
    await maria.query('DROP TABLE IF EXISTS books;');

    await maria.query(`CREATE TABLE books (
      id INT NOT NULL AUTO_INCREMENT,
      totalvolume TEXT NULL,
      description TEXT NULL,
      sync TEXT NULL,
      type TEXT NULL,
      name TEXT NULL,
      cover TEXT NULL,
      isdeleted TINYINT(1) NULL,
      systemmodstamp DATETIME NULL,
      order_no TEXT NULL,
      createddate DATETIME NULL,
      author TEXT NULL,
      createdbyid TEXT NULL,
      encrypt TEXT NULL,
      sfid TEXT NULL,
      hc_lastop TEXT NULL,
      hc_err LONGTEXT NULL,
      PRIMARY KEY (id),
      INDEX idx_books_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

    await maria.query(`CREATE TABLE book_volumes (
      id INT NOT NULL AUTO_INCREMENT,
      seq INT NULL,
      book INT NOT NULL,
      cover TEXT NULL,
      isbn13 TEXT NULL,
      price TEXT NULL,
      ispurchased BOOLEAN NULL,
      name TEXT NULL,
      type TEXT NULL,
      volume INT NULL,
      noneedtobuy TINYINT(1) NULL,
      isbn TEXT NULL,
      description TEXT NULL,
      link TEXT NULL,
      pubdate DATETIME NULL,
      createddate DATETIME NULL,
      author TEXT NULL,
      PRIMARY KEY (id),
      INDEX idx_book_volumes_book (book),
      CONSTRAINT fk_book_volumes_books
        FOREIGN KEY (book) REFERENCES books (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

    const bookSourceCols = ['s_originalkey__c', 'totalvolume__c', 'description__c', 'sync__c', 'type__c', 'name', 'cover__c', 'isdeleted', 'systemmodstamp', 'order__c', 'createddate', 'author__c', 'createdbyid', 'encrypt__c', 'sfid', '_hc_lastop', '_hc_err'];
    const bookTargetCols = ['id', 'totalvolume', 'description', 'sync', 'type', 'name', 'cover', 'isdeleted', 'systemmodstamp', 'order_no', 'createddate', 'author', 'createdbyid', 'encrypt', 'sfid', 'hc_lastop', 'hc_err'];

    const volCols = ['seq', 'book', 'cover', 'isbn13', 'price', 'ispurchased', 'name', 'type', 'volume', 'noneedtobuy', 'id', 'isbn', 'description', 'link', 'pubdate', 'author', 'createddate'];

    const bookSelect = `SELECT ${bookSourceCols.join(', ')} FROM devint.book__c ORDER BY id ASC`;
    const volSelect = `
      SELECT
        v.seq,
        b.id AS book,
        v.cover,
        v.isbn13,
        v.price,
        v.ispurchased,
        v.name,
        v.type,
        v.volume,
        v.noneedtobuy,
        v.id,
        v.isbn,
        v.description,
        v.link,
        v.pubdate,
        v.author,
        v.pubdate AS createddate
      FROM devext.bookbyvolume v
      INNER JOIN devint.book__c b
        ON b.sfid = v.book
      ORDER BY v.id ASC
    `;

    const bookRows = (await pg.query(bookSelect)).rows;
    const volRows = (await pg.query(volSelect)).rows;

    const bookInsert = `INSERT INTO books (${bookTargetCols.map((c) => `\`${c}\``).join(', ')}) VALUES (${bookTargetCols.map(() => '?').join(', ')});`;
    const volInsert = `INSERT INTO book_volumes (${volCols.map((c) => `\`${c}\``).join(', ')}) VALUES (${volCols.map(() => '?').join(', ')});`;

    for (const row of bookRows) {
      const vals = [
        Number(row.id),
        toValue(row.totalvolume__c),
        toValue(row.description__c),
        toValue(row.sync__c),
        toValue(row.type__c),
        toValue(row.name),
        toValue(row.cover__c),
        toBool(row.isdeleted),
        toValue(row.systemmodstamp),
        toValue(row.order__c),
        toValue(row.createddate),
        toValue(row.author__c),
        toValue(row.createdbyid),
        toValue(row.encrypt__c),
        toValue(row.sfid),
        toValue(row._hc_lastop),
        toValue(row._hc_err),
      ];
      await maria.execute(bookInsert, vals);
    }

    for (const row of volRows) {
      const vals = [
        toValue(row.seq),
        toValue(row.book),
        toValue(row.cover),
        toValue(row.isbn13),
        toValue(row.price),
        toBool(row.ispurchased),
        toValue(row.name),
        toValue(row.type),
        toValue(row.volume),
        toBool(row.noneedtobuy),
        toValue(row.id),
        toValue(row.isbn),
        toValue(row.description),
        toValue(row.link),
        toValue(row.pubdate),
        toValue(row.author),
        toValue(row.createddate),
      ];
      await maria.execute(volInsert, vals);
    }

    const [[{ cnt: bookCnt }]] = await maria.query('SELECT COUNT(*) AS cnt FROM books');
    const [[{ cnt: volCnt }]] = await maria.query('SELECT COUNT(*) AS cnt FROM book_volumes');

    const [[{ maxBookId }]] = await maria.query('SELECT IFNULL(MAX(id),0) AS maxBookId FROM books');
    const [[{ maxVolId }]] = await maria.query('SELECT IFNULL(MAX(id),0) AS maxVolId FROM book_volumes');
    await maria.query(`ALTER TABLE books AUTO_INCREMENT = ${maxBookId + 1}`);
    await maria.query(`ALTER TABLE book_volumes AUTO_INCREMENT = ${maxVolId + 1}`);

    console.log(`Migration done. books=${bookCnt}, book_volumes=${volCnt}`);
    console.log(`Auto increments set => books:${maxBookId + 1}, book_volumes:${maxVolId + 1}`);
  } finally {
    await pg.end().catch(() => {});
    await maria.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});
