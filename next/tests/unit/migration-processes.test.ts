import { afterEach, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { waitForChildExit } from "@/features/migration/processes";

const children: ChildProcess[] = [];
function launch(code: string) {
  const child = spawn(process.execPath, ["-e", code], { stdio: "ignore" });
  children.push(child);
  return child;
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
});

it("remembers an exit that occurs before startup finishes awaiting other work", async () => {
  const child = launch("process.exit(7)");
  const exited = waitForChildExit(child);
  await once(child, "exit");
  await expect(exited).resolves.toBeUndefined();
  expect(child.exitCode).toBe(7);
  expect(child.listenerCount("exit")).toBe(0);
  expect(child.listenerCount("error")).toBe(0);
});

it.each(["normal", "signal"])("also handles a child already terminated by %s", async (mode) => {
  const child = launch(mode === "normal" ? "process.exit(0)" : "setInterval(() => {}, 1000)");
  const exited = once(child, "exit");
  if (mode === "signal") child.kill("SIGTERM");
  await exited;
  await expect(waitForChildExit(child)).resolves.toBeUndefined();
  expect(mode === "normal" ? child.exitCode : child.signalCode).toBe(mode === "normal" ? 0 : "SIGTERM");
});
