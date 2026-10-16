import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.BOOKSHELF_DB_PATH ?? "./data/bookshelf.sqlite"
  },
  strict: true,
  verbose: true
});
