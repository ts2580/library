import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export default function cleanup() {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (directory && path.dirname(directory) === tmpdir() && path.basename(directory).startsWith("bookshelf-e2e-")) {
    rmSync(directory, { recursive: true, force: true });
  }
}
