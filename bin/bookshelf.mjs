#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      port: { type: "string", short: "p" },
      hostname: { type: "string", short: "H" },
      "data-dir": { type: "string" }
    }
  });
  if (values.version) { console.log(pkg.version); return; }
  if (values.help) {
    console.log(`Bookshelf ${pkg.version}
Usage: bookshelf [start|web|worker|db:migrate] [options]

  start                 Start web and worker together (default)
  web                   Start only the web server
  worker                Start only the background worker (one per database)
  db:migrate            Bootstrap/migrate the database and check integrity
  -p, --port <port>     Web port (PORT or 25647)
  -H, --hostname <host> Web bind address (HOSTNAME or 0.0.0.0)
  --data-dir <path>     Data directory (BOOKSHELF_DATA_DIR or ./data)
  -v, --version        Show version
  -h, --help           Show help

Loads .env from the current directory. Relative data paths use that directory.
For the first account, run with REGISTRATION=true and visit /signup.`);
    return;
  }
  const command = positionals[0] ?? "start";
  if (positionals.length > 1 || !["start", "web", "worker", "db:migrate"].includes(command)) {
    throw new Error("Unknown command. Run bookshelf --help.");
  }
  const caller = process.cwd();
  process.env.NODE_ENV = "production";
  require("@next/env").loadEnvConfig(caller, false);
  const port = values.port ?? process.env.PORT ?? "25647";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Port must be 1-65535.");
  const dataRoot = path.resolve(caller, values["data-dir"] ?? process.env.BOOKSHELF_DATA_DIR ?? "./data");
  // Keep the source application's guard against silently opening an empty DB.
  if (dataRoot === path.join(caller, "data") && !existsSync(path.join(dataRoot, "active-migration.json"))
      && (!process.env.BOOKSHELF_DB_PATH || path.resolve(caller, process.env.BOOKSHELF_DB_PATH) === path.join(dataRoot, "bookshelf.sqlite"))
      && ["active-migration.json", "bookshelf.sqlite"].some(name => existsSync(path.join(caller, "next/data", name)))) {
    throw new Error("Move next/data to the root data directory before starting Bookshelf.");
  }
  process.env.BOOKSHELF_DATA_DIR = dataRoot;
  for (const key of ["BOOKSHELF_DB_PATH", "BOOKSHELF_LEGACY_DATA_DIR"]) {
    if (process.env[key]) process.env[key] = path.resolve(caller, process.env[key]);
  }
  const web = [require.resolve("next/dist/bin/next"), "start", "--port", port,
    "--hostname", values.hostname ?? process.env.HOSTNAME ?? "0.0.0.0"];
  const worker = ["--conditions=react-server", path.join(root, "dist/worker.cjs")];
  const migrate = ["--conditions=react-server", path.join(root, "dist/migrate.cjs")];
  const commands = command === "start" ? [web, worker] : [command === "web" ? web : command === "worker" ? worker : migrate];
  const children = [];
  const windows = process.platform === "win32";
  let stopping = false;
  function signalTree(child, signal) {
    if (!child.pid) return;
    if (windows) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
        .on("error", error => console.error(error.message));
    } else {
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== "ESRCH") console.error(error.message); }
    }
  }
  function alive(child) {
    if (!child.pid) return false;
    if (windows) return child.exitCode === null && child.signalCode === null;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
  }
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) signalTree(child, "SIGTERM");
    const poll = setInterval(() => {
      if (children.every(child => !alive(child))) {
        clearInterval(poll);
        clearTimeout(force);
      }
    }, 100);
    const force = setTimeout(() => {
      for (const child of children) signalTree(child, "SIGKILL");
      clearInterval(poll);
    }, 5000);
  }
  process.on("SIGINT", () => stop(130));
  process.on("SIGTERM", () => stop(143));
  for (const args of commands) {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", detached: !windows });
    children.push(child);
    child.on("error", error => { console.error(error.message); stop(1); });
    child.on("exit", (code, signal) => {
      if (!stopping) stop(code ?? (signal === "SIGINT" ? 130 : 1));
    });
  }
}
main().catch(error => { console.error(`[bookshelf] ${error.message}`); process.exitCode = 1; });
