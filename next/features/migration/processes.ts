import type { ChildProcess } from "node:child_process";

// Observe immediately after spawn and retain the promise across async startup checks.
export function waitForChildExit(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      child.off("exit", finish);
      child.off("error", finish);
      resolve();
    };
    child.once("exit", finish);
    child.once("error", finish);
  });
}
