import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

vi.mock("@next/env", () => ({ loadEnvConfig: vi.fn() }));
const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs(); vi.resetModules();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it.each(["fresh", "handover", "explicit"])("Drizzle follows the runtime database for %s data roots", async mode => {
  const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-drizzle-")); directories.push(directory);
  let expected = path.join(directory, "bookshelf.sqlite");
  if (mode === "handover") {
    const adopted = path.join(directory, "migrations/handover-aabb"); mkdirSync(adopted, { recursive: true });
    expected = path.join(adopted, "bookshelf.sqlite"); writeFileSync(expected, "fixture");
    writeFileSync(path.join(directory, "active-migration.json"), JSON.stringify({ version: 1, dataDir: "data/migrations/handover-aabb" }));
  }
  if (mode === "explicit") expected = path.join(directory, "selected.sqlite");
  vi.stubEnv("BOOKSHELF_DATA_DIR", directory);
  vi.stubEnv("BOOKSHELF_DB_PATH", mode === "explicit" ? expected : undefined);
  const { default: config } = await import("../../drizzle.config");
  expect(config).toMatchObject({ dbCredentials: { url: expected } });
});

it("loads the selected database from the CLI working directory's .env", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-drizzle-env-")); directories.push(directory);
  writeFileSync(path.join(directory, ".env"), "BOOKSHELF_DATA_DIR=./custom-data\n");
  const configUrl = pathToFileURL(path.resolve("drizzle.config.ts")).href;
  const result = execFileSync(process.execPath, ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), "--input-type=module", "-e",
    `const module = await import(${JSON.stringify(configUrl)}); const config = module.default.default ?? module.default; console.log(JSON.stringify(config.dbCredentials));`
  ], { cwd: directory, encoding: "utf8", env: { ...process.env, NODE_ENV: "production", BOOKSHELF_DB_PATH: undefined, BOOKSHELF_DATA_DIR: undefined } });
  expect(JSON.parse(result.trim().split("\n").at(-1)!)).toEqual({ url: path.join(directory, "custom-data/bookshelf.sqlite") });
});
