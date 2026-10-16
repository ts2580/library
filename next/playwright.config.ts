import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const fixtureDirectory = process.env.BOOKSHELF_E2E_DATA ?? mkdtempSync(path.join(tmpdir(), "bookshelf-e2e-"));
process.env.BOOKSHELF_E2E_DATA = fixtureDirectory;
const baseURL = "http://127.0.0.1:25648";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/cleanup.ts",
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "npm run test:e2e:server",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BOOKSHELF_DB_PATH: path.join(fixtureDirectory, "bookshelf.sqlite"),
      BOOKSHELF_DATA_DIR: fixtureDirectory,
      BOOKSHELF_LEGACY_OWNER_USERNAME: "fixture-admin",
      REGISTRATION: "false",
      ALADIN_TTB_KEY: "fixture-only-api-key",
      NEXT_TELEMETRY_DISABLED: "1"
    }
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
