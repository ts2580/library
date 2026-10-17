import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";

const root = process.cwd();
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set(["node_modules", ".next", ".git", "next", "legacy-data", "coverage", "playwright-report", "test-results", "data", ".gradle", ".gradle-user-home", "build", "temp"]);
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function moduleCandidates(base) {
  const candidates = [base];
  for (const extension of sourceExtensions) candidates.push(`${base}${extension}`);
  for (const extension of sourceExtensions) candidates.push(path.join(base, `index${extension}`));
  candidates.push(`${base}.json`);
  return candidates;
}

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const base = specifier.startsWith("@/")
    ? path.join(root, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  return moduleCandidates(base).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? undefined;
}

function importsOf(source) {
  const imports = new Set();
  const staticPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  const sideEffectPattern = /import\s*["']([^"']+)["']/g;
  const dynamicPattern = /import\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticPattern, sideEffectPattern, dynamicPattern]) {
    let match;
    while ((match = pattern.exec(source)) != null) imports.add(match[1]);
  }
  return [...imports];
}

const files = walk(root);
const sources = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));
const graph = new Map();
const failures = [];

for (const [file, source] of sources) {
  const edges = [];
  for (const specifier of importsOf(source)) {
    // Next generates these declarations on dev/build; a source-only checkout has none.
    if (relative(file) === "next-env.d.ts" && specifier.startsWith("./.next/")) continue;
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const resolved = resolveLocal(file, specifier);
      if (resolved === undefined) failures.push(`${relative(file)}: resolve할 수 없는 로컬 import '${specifier}'`);
      else if (resolved) edges.push(resolved);
    }
    if (/^["']?node:/.test(specifier) && /^\s*["']use client["'];?/m.test(source)) {
      failures.push(`${relative(file)}: Client Component가 Node 내장 모듈 '${specifier}'을 import합니다.`);
    }
    if (builtins.has(specifier) && /^\s*["']use client["'];?/m.test(source)) {
      failures.push(`${relative(file)}: Client Component가 Node 내장 모듈 '${specifier}'을 import합니다.`);
    }
  }
  graph.set(file, edges);
}

function hasDirective(source, directive) {
  return new RegExp(`^\\s*["']${directive}["'];?`).test(source);
}

function isServerBoundary(source) {
  return /(?:^|\n)\s*import\s+["']server-only["']/.test(source) || hasDirective(source, "use server");
}

for (const [file, source] of sources) {
  if (!hasDirective(source, "use client")) continue;
  const visited = new Set();
  const stack = (graph.get(file) ?? []).map((target) => ({ target, chain: [file, target] }));
  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current.target)) continue;
    visited.add(current.target);
    const targetSource = sources.get(current.target) ?? "";
    if (hasDirective(targetSource, "use server")) continue; // imported Server Action reference is allowed.
    if (isServerBoundary(targetSource)) {
      failures.push(`${relative(file)}: client → server-only 경계 침범 (${current.chain.map(relative).join(" → ")})`);
      continue;
    }
    for (const next of graph.get(current.target) ?? []) stack.push({ target: next, chain: [...current.chain, next] });
  }
}

for (const [file, source] of sources) {
  const name = relative(file);
  if (/^app\/.*\.(ts|tsx)$/.test(name) && !hasDirective(source, "use client") && /fetch\(\s*[`"']\/api\//.test(source)) {
    failures.push(`${name}: Server Component/Route가 자기 /api 경로를 HTTP로 다시 호출합니다.`);
  }
}

for (const forbidden of ["public/covers", "public/uploads", "public/bookshelf.sqlite"]) {
  if (fs.existsSync(path.join(root, forbidden))) failures.push(`${forbidden}: 런타임 데이터는 public 아래에 둘 수 없습니다.`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const script of ["start", "worker", "check:syntax", "check:structure"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json: '${script}' script가 없습니다.`);
}

const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
if (!/\bweb:/.test(compose) || !/\bworker:/.test(compose)) failures.push("docker-compose.yml: web/worker 서비스가 모두 필요합니다.");
if ((compose.match(/bookshelf-data:\/app\/data/g) ?? []).length < 2) failures.push("docker-compose.yml: web와 worker가 동일한 /app/data 볼륨을 공유해야 합니다.");

if (failures.length) {
  console.error(`Structure check failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Structure check passed (${files.length} source files, local imports and client/server boundaries verified).`);
