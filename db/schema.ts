import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const bookshelfMigrations = sqliteTable("bookshelf_migrations", {
  version: integer("version").primaryKey(),
  appliedAt: text("applied_at").notNull(),
  backupPath: text("backup_path")
});

export const members = sqliteTable(
  "member",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    email: text("email"),
    name: text("name"),
    description: text("description"),
    role: text("role", { enum: ["USER", "ADMIN"] }).notNull().default("USER")
  },
  (table) => [uniqueIndex("ux_member_username").on(table.username)]
);

export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    totalVolume: text("totalvolume"),
    description: text("description"),
    sync: text("sync"),
    type: text("type"),
    name: text("name"),
    cover: text("cover"),
    isDeleted: integer("isdeleted", { mode: "boolean" }),
    systemModstamp: text("systemmodstamp"),
    orderNo: text("order_no"),
    createdDate: text("createddate").default(sql`CURRENT_TIMESTAMP`),
    author: text("author"),
    createdById: text("createdbyid"),
    encrypt: text("encrypt"),
    sfid: text("sfid"),
    hcLastOp: text("hc_lastop"),
    hcError: text("hc_err"),
    ownerId: integer("owner_id").references(() => members.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    coverGenerated: integer("cover_generated", { mode: "boolean" }).notNull().default(false)
  },
  (table) => [
    index("idx_books_name").on(table.name),
    index("idx_books_author").on(table.author),
    index("idx_books_type").on(table.type),
    index("idx_books_type_id").on(table.type, table.id),
    index("idx_books_owner_id").on(table.ownerId)
  ]
);

export const bookCategories = sqliteTable("book_categories", {
  name: text("name").primaryKey(),
  createdDate: text("createddate").default(sql`CURRENT_TIMESTAMP`)
});

export const persistentLogins = sqliteTable("persistent_logins", {
  username: text("username").notNull(),
  series: text("series").primaryKey(),
  token: text("token").notNull(),
  lastUsed: text("last_used").notNull()
});

export const bookVolumes = sqliteTable(
  "book_volumes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seq: integer("seq"),
    bookId: integer("book").notNull().references(() => books.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    cover: text("cover"),
    originalUrl: text("originalUrl"),
    isbn13: text("isbn13"),
    price: text("price"),
    isPurchased: integer("ispurchased", { mode: "boolean" }).notNull().default(false),
    name: text("name"),
    type: text("type"),
    volume: integer("volume"),
    noNeedToBuy: integer("noneedtobuy", { mode: "boolean" }).default(false),
    isbn: text("isbn"),
    description: text("description"),
    link: text("link"),
    pubDate: text("pubdate"),
    createdDate: text("createddate"),
    author: text("author"),
    coverGenerated: integer("cover_generated", { mode: "boolean" }).notNull().default(false)
  },
  (table) => [
    index("idx_book_volumes_book").on(table.bookId),
    index("idx_book_volumes_book_volume").on(table.bookId, table.volume),
    index("idx_book_volumes_isbn13").on(table.isbn13),
    index("idx_book_volumes_ispurchased").on(table.isPurchased),
    index("idx_book_volumes_stock_refresh_target").on(table.isPurchased, table.noNeedToBuy, table.id),
    index("idx_book_volumes_createddate").on(table.createdDate)
  ]
);

export const branchBooks = sqliteTable(
  "branchbook",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookLink: text("booklink"),
    purchaseUrl: text("purchaseurl"),
    branch: text("branch"),
    uuid: text("uuid"),
    volume: real("volume"),
    name: text("name"),
    price: text("price"),
    branchName: text("branchname"),
    grade: text("grade"),
    createdDate: text("createddate").default(sql`CURRENT_TIMESTAMP`),
    bookId: integer("book").references(() => books.id, { onDelete: "cascade" }),
    bookVolumeId: integer("book_volume_id").references(() => bookVolumes.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    systemModstamp: text("systemmodstamp").default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("ux_branchbook_uuid").on(table.uuid),
    index("idx_branchbook_book").on(table.bookId),
    index("idx_branchbook_branch").on(table.branch),
    index("idx_branchbook_book_volume").on(table.bookId, table.volume),
    index("idx_branchbook_book_volume_id").on(table.bookVolumeId)
  ]
);

export const branchInventorySummary = sqliteTable(
  "branch_inventory_summary",
  {
    branch: text("branch").primaryKey(),
    branchName: text("branch_name").notNull(),
    stockCount: integer("stock_count").notNull().default(0),
    pricedCount: integer("priced_count").notNull().default(0),
    totalAmount: integer("total_amount").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    index("idx_branch_inventory_summary_total_amount").on(table.totalAmount),
    index("idx_branch_inventory_summary_updated_at").on(table.updatedAt)
  ]
);

export const stockRefreshJobs = sqliteTable("stock_refresh_job", {
  id: integer("id").primaryKey(),
  running: integer("running", { mode: "boolean" }).notNull().default(false),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  failed: integer("failed", { mode: "boolean" }).notNull().default(false),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  success: integer("success").notNull().default(0),
  empty: integer("empty").notNull().default(0),
  fail: integer("fail").notNull().default(0),
  percent: integer("percent").notNull().default(0),
  message: text("message"),
  updatedAt: text("updated_at"),
  status: text("status", { enum: ["IDLE", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] }).notNull().default("IDLE"),
  requestedBy: integer("requested_by").references(() => members.id, { onDelete: "set null" }),
  mode: text("mode", { enum: ["REPLACE_ALL", "APPEND_BOOK", "REFRESH_SELECTED"] }).notNull().default("REPLACE_ALL"),
  scopeBookId: integer("scope_book_id").references(() => books.id, { onDelete: "set null" }),
  runId: text("run_id"),
  lockToken: text("lock_token"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  heartbeatAt: text("heartbeat_at")
});

export const stockRefreshCompletions = sqliteTable("stock_refresh_completion", {
  ownerId: integer("owner_id").primaryKey().references(() => members.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull()
});

export const stockRefreshLogs = sqliteTable("stock_refresh_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: integer("owner_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  bookId: integer("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  volumeId: integer("volume_id").notNull().references(() => bookVolumes.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  isbn13: text("isbn13"),
  status: text("status", { enum: ["SUCCESS", "EMPTY", "FAILED"] }).notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
}, table => [uniqueIndex("ux_stock_refresh_log_run_volume").on(table.runId, table.volumeId),
  index("idx_stock_refresh_log_owner_volume").on(table.ownerId, table.volumeId, table.id),
  index("idx_stock_refresh_log_owner_id").on(table.ownerId, table.id)]);

export const stockRefreshJobTargets = sqliteTable("stock_refresh_job_target", {
  jobId: integer("job_id").notNull().references(() => stockRefreshJobs.id, { onDelete: "cascade" }),
  volumeId: integer("volume_id").notNull().references(() => bookVolumes.id, { onDelete: "cascade" })
}, table => [primaryKey({ columns: [table.jobId, table.volumeId] })]);

export const appSessions = sqliteTable(
  "app_sessions",
  {
    idHash: text("id_hash").primaryKey(),
    memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    userAgentHash: text("user_agent_hash")
  },
  (table) => [
    index("idx_app_sessions_member").on(table.memberId),
    index("idx_app_sessions_expires").on(table.expiresAt)
  ]
);

export const backupUploadJobs = sqliteTable(
  "backup_upload_job",
  {
    uploadId: text("upload_id").primaryKey(),
    ownerId: integer("owner_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    totalSize: integer("total_size").notNull(),
    totalChunks: integer("total_chunks").notNull(),
    uploadedChunks: integer("uploaded_chunks").notNull().default(0),
    status: text("status", { enum: ["UPLOADING", "ASSEMBLING", "QUEUED", "PROCESSING", "COMPLETED", "FAILED"] }).notNull().default("UPLOADING"),
    message: text("message"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lockToken: text("lock_token")
  },
  (table) => [index("idx_backup_upload_owner").on(table.ownerId), index("idx_backup_upload_status").on(table.status)]
);

export type Member = typeof members.$inferSelect;
export type Book = typeof books.$inferSelect;
export type BookVolume = typeof bookVolumes.$inferSelect;
export type BranchBook = typeof branchBooks.$inferSelect;
