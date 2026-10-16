import "server-only";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { z } from "zod";
import { activeMigrationPaths } from "@/lib/active-migration";

// The web server, migration CLI, and worker must resolve the same .env files.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOOKSHELF_DB_PATH: z.string().default("./data/bookshelf.sqlite"),
  BOOKSHELF_DATA_DIR: z.string().default("./data"),
  BOOKSHELF_LEGACY_DATA_DIR: z.string().default("../data"),
  BOOKSHELF_LEGACY_OWNER_USERNAME: z.string().trim().min(1).default("trstyq"),
  REGISTRATION: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  BOOKSHELF_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  BOOKSHELF_REMEMBER_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  BOOKSHELF_COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  BOOKSHELF_AUTO_BACKUP: z.string().default("true").transform((value) => value !== "false"),
  BOOKSHELF_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ALADIN_TTB_KEY: z.string().default(""),
  ALADIN_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).default(100),
  ALADIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ALADIN_INITIAL_BACKOFF_MS: z.coerce.number().int().min(50).max(60_000).default(2_000),
  ALADIN_MAX_BACKOFF_MS: z.coerce.number().int().min(100).max(300_000).default(30_000)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

const raw = parsed.data;
const cwd = process.cwd();
const explicitPaths = (process.env.BOOKSHELF_DB_PATH && path.resolve(/* turbopackIgnore: true */ cwd, process.env.BOOKSHELF_DB_PATH) !== path.join(cwd, "data/bookshelf.sqlite"))
  || (process.env.BOOKSHELF_DATA_DIR && path.resolve(/* turbopackIgnore: true */ cwd, process.env.BOOKSHELF_DATA_DIR) !== path.join(cwd, "data"));
const active = explicitPaths ? null : activeMigrationPaths(cwd);
const dataDir = active?.dataDir ?? path.resolve(/* turbopackIgnore: true */ cwd, raw.BOOKSHELF_DATA_DIR);

export const env = {
  ...raw,
  databasePath: active?.databasePath ?? path.resolve(/* turbopackIgnore: true */ cwd, raw.BOOKSHELF_DB_PATH),
  dataDir,
  legacyDataDir: path.resolve(/* turbopackIgnore: true */ cwd, raw.BOOKSHELF_LEGACY_DATA_DIR),
  coversDir: path.join(dataDir, "covers"),
  uploadsDir: path.join(dataDir, "uploads"),
  backupsDir: path.join(dataDir, "backups")
} as const;
