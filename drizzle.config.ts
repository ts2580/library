import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";
import { resolveDataPaths } from "./lib/active-migration";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const { databasePath } = resolveDataPaths(process.cwd(), process.env.BOOKSHELF_DATA_DIR, process.env.BOOKSHELF_DB_PATH);

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databasePath
  },
  strict: true,
  verbose: true
});
