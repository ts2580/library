import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const image = process.argv[2] ?? "bookshelf-next:migration-local";
const suffix = randomUUID().slice(0, 8);
const volume = `bookshelf-migration-test-${suffix}`;
const web = `bookshelf-migration-web-${suffix}`;
const worker = `bookshelf-migration-worker-${suffix}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const containers = [];

try {
  docker("volume", "create", "--label", "bookshelf.migration-test=true", volume);
  containers.push(web);
  docker("run", "-d", "--name", web, "--label", "bookshelf.migration-test=true", "--publish", "127.0.0.1::25647", "--volume", `${volume}:/data`, image);
  const port = docker("port", web, "25647/tcp").split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch { /* wait for startup */ }
    if (docker("inspect", "--format", "{{.State.Running}}", web) !== "true") throw new Error(docker("logs", web));
    await sleep(250);
  }
  if (!healthy) throw new Error("Docker web did not become healthy");
  containers.push(worker);
  docker("run", "-d", "--name", worker, "--label", "bookshelf.migration-test=true", "--no-healthcheck", "--volume", `${volume}:/data`, image, "npm", "run", "worker");
  await sleep(1000);
  if (docker("inspect", "--format", "{{.State.Running}}", worker) !== "true") throw new Error(docker("logs", worker));
  const raw = docker("exec", worker, "npm", "run", "db:verify");
  const database = JSON.parse(raw.slice(raw.lastIndexOf("\n{") + 1));
  const unauthenticated = (await fetch(`${base}/api/stock-refresh`)).status;
  if (unauthenticated !== 401) throw new Error(`Anonymous API status: ${unauthenticated}`);
  if ((await fetch(`${base}/login`)).status !== 200) throw new Error("Docker login page failed");
  const mounts = [web, worker].map((container) => JSON.parse(docker("inspect", "--format", "{{json .Mounts}}", container)));
  if (!mounts.every((list) => list.some((mount) => mount.Name === volume && mount.Destination === "/data"))) throw new Error("Shared volume mismatch");
  const report = {
    passed: true, image: docker("image", "inspect", "--format", "{{.Id}}", image),
    node: docker("exec", worker, "node", "--version"), uid: docker("exec", web, "id", "-u"),
    sharedVolume: true, unauthenticatedApiStatus: unauthenticated, database
  };
  if (report.uid !== "1001") throw new Error("Web must run as the unprivileged user");
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/docker-smoke.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const container of containers.reverse()) {
    try { docker("rm", "-f", container); } catch { /* already exited or never created */ }
  }
  try { docker("volume", "rm", volume); } catch { /* preserve on cleanup error */ }
}
