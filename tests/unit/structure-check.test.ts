import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directories: string[] = [];
const checker = fileURLToPath(new URL("../../scripts/check-structure.mjs", import.meta.url));
const declaration = (specifier: string) => ["import", JSON.stringify(specifier)].join(" ") + ";\n";
function checkout() {
  const directory = mkdtempSync(path.join(tmpdir(), "bookshelf-structure-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "next-env.d.ts"), declaration("./.next/dev/types/routes.d.ts") + declaration("./.next/dev/types/root-params.d.ts"));
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ scripts: { start: "next start", worker: "worker", "check:syntax": "syntax", "check:structure": "structure" } }));
  writeFileSync(path.join(directory, "docker-compose.yml"), "services:\n  web:\n    volumes: [bookshelf-data:/data]\n  worker:\n    volumes: [bookshelf-data:/data]\n");
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("checks a clean source checkout without Next generated declarations", () => {
  const result = spawnSync(process.execPath, [checker], { cwd: checkout(), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

it("still rejects missing application imports, including direct imports of generated files", () => {
  const directory = checkout();
  mkdirSync(path.join(directory, "app"));
  writeFileSync(path.join(directory, "app/page.ts"), declaration("./missing") + declaration("../.next/types/missing"));
  const result = spawnSync(process.execPath, [checker], { cwd: directory, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("'./missing'");
  expect(result.stderr).toContain("'../.next/types/missing'");
});
