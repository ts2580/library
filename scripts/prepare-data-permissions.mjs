import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Used only by the release Compose's one-shot root service, before web/worker start.
if (process.getuid?.() !== 0) throw new Error("Data permission preparation requires root");
for (const directory of ["/data", "/data/legacy"]) {
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("Data roots must not be symlinks");
  // Do not follow symlinks or cross filesystem boundaries; legacy is handled separately.
  execFileSync("find", [directory, "-xdev", "(", "!", "-uid", "1001", "-o", "!", "-gid", "1001", ")",
    "-exec", "chown", "-h", "1001:1001", "{}", "+"], { stdio: "inherit" });
}
console.log("PASS data and legacy volume ownership prepared for UID/GID 1001");
