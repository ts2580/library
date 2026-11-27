import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const local = process.argv.includes("--local");
function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
const baseCommit = git("rev-parse", "HEAD");
function checkReleaseSource() {
  if (!local && (git("status", "--porcelain", "--untracked-files=normal") || git("rev-parse", "HEAD") !== baseCommit)) {
    throw new Error("Release packaging requires a clean, unchanged commit. Use npm run package:npm -- --local for a working-tree build.");
  }
}
checkReleaseSource();
const provenance = local ? { sourceType: "working-tree", baseCommit, sourceCommit: null }
  : { sourceType: "commit", sourceCommit: baseCommit };
const output = path.join(root, "temp/npm", local ? "local" : "", pkg.version);
const stage = path.join(output, "package");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run through npm run package:npm.");
const npmEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
// npm run exports this CLI-only option; project installs use allowScripts instead.
for (const key of Object.keys(npmEnv)) if (key.toLowerCase() === "npm_config_allow_scripts") delete npmEnv[key];
function runNpm(args, cwd = root, capture = false) {
  const result = spawnSync(process.execPath, [npm, ...args], {
    cwd, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8",
    env: npmEnv
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`npm ${args.join(" ")} failed (${result.status})`);
  return result.stdout;
}
// npm omits node_modules symlinks, including Turbopack's hashed external aliases.
// Webpack emits portable external package names for the npm distribution.
// Always build from source; do not package an unrelated or stale .next tree.
runNpm(["run", "build", "--", "--webpack"]);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "dist"), { recursive: true });
for (const name of [".next", "public", "bin"]) {
  fs.cpSync(path.join(root, name), path.join(stage, name), {
    recursive: true,
    filter: source => !["cache", "dev", "diagnostics", "trace", "trace-build", "types"].includes(path.basename(source))
  });
}
const ts = require("typescript");
fs.writeFileSync(path.join(stage, "next.config.mjs"), ts.transpileModule(
  fs.readFileSync(path.join(root, "next.config.ts"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
).outputText);
const { build } = require("esbuild");
await build({
  absWorkingDir: root,
  entryPoints: { worker: "worker/worker.ts", migrate: "scripts/migrate.ts" },
  outdir: path.join(stage, "dist"), outExtension: { ".js": ".cjs" },
  bundle: true, platform: "node", target: "node22", format: "cjs", packages: "external",
  tsconfig: path.join(root, "tsconfig.json"), logLevel: "info"
});
const dependencies = { ...pkg.dependencies };
delete dependencies.tsx;
delete dependencies["@tailwindcss/postcss"];
const manifest = {
  name: "@trstyq/bookshelf", version: pkg.version, description: pkg.description,
  engines: pkg.engines,
  ...(local ? { private: true } : {}),
  bin: { bookshelf: "bin/bookshelf.mjs" },
  files: ["bin/", "dist/", ".next/", "public/", "next.config.mjs", "bookshelf.env.example", "release.json"],
  scripts: { start: "node bin/bookshelf.mjs", worker: "node bin/bookshelf.mjs worker" },
  publishConfig: { access: "public", registry: "https://registry.npmjs.org/", tag: pkg.version.includes("-") ? "rc" : "latest" },
  repository: { type: "git", url: "git+https://github.com/ts2580/library.git" },
  homepage: "https://github.com/ts2580/library#readme",
  bugs: { url: "https://github.com/ts2580/library/issues" },
  dependencies, overrides: pkg.overrides,
  // Keep ExcelJS's uuid override for consumers; dependency overrides are not inherited.
  bundleDependencies: ["exceljs"],
  allowScripts: { "better-sqlite3": true, sharp: true }
};
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.copyFileSync(path.join(root, ".env.example"), path.join(stage, "bookshelf.env.example"));
fs.copyFileSync(path.join(root, "docs/NPM.md"), path.join(stage, "README.md"));
fs.chmodSync(path.join(stage, "bin/bookshelf.mjs"), 0o755);
checkReleaseSource();
fs.writeFileSync(path.join(stage, "release.json"), JSON.stringify({ name: manifest.name, version: pkg.version, ...provenance }, null, 2) + "\n");
// Materialize only JavaScript bundles; native modules are installed on the
// consumer's platform. npm 12 no longer distributes dependency shrinkwraps.
runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], stage);
// Make the bundled dependency edge agree with the already installed override.
// npm 12 rejects override-dependent bundles whose manifests still request uuid 8.
const excelManifestPath = path.join(stage, "node_modules/exceljs/package.json");
const excelManifest = JSON.parse(fs.readFileSync(excelManifestPath, "utf8"));
excelManifest.dependencies.uuid = pkg.overrides.exceljs.uuid;
fs.writeFileSync(excelManifestPath, JSON.stringify(excelManifest, null, 2) + "\n");
delete manifest.overrides;
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.rmSync(path.join(stage, "node_modules/.package-lock.json"), { force: true });
const packResult = JSON.parse(runNpm(["pack", "--json", "--pack-destination", output], stage, true));
const packed = Array.isArray(packResult) ? packResult[0] : packResult[manifest.name];
if (!packed?.files?.some(file => file.path === ".next/BUILD_ID")) throw new Error("Packed application build is missing");
for (const file of packed.files) {
  if (/^(data|legacy-data|tests)(\/|$)/.test(file.path) || /^\.next\/(cache|dev)\//.test(file.path)
      || /(^|\/)\.env(?:\.|$)/.test(file.path) || /\.(sqlite|node)(?:-|$)/.test(file.path)) {
    throw new Error(`Unexpected private/runtime file in package: ${file.path}`);
  }
}
const tarball = path.join(output, packed.filename);
const sha256 = createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
fs.writeFileSync(path.join(output, "pack.json"), JSON.stringify({ ...packed, sha256, ...provenance }, null, 2) + "\n");
console.log(JSON.stringify({ tarball, version: pkg.version, ...provenance, files: packed.entryCount, size: packed.size, integrity: packed.integrity, sha256 }, null, 2));
