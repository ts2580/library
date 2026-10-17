import { setTimeout as sleep } from "node:timers/promises";
import "@/db";
import { env } from "@/lib/env";
import { acquireWorkerLock } from "./singleton";
import { logger } from "@/lib/logger";
import { purgeExpiredSessions } from "@/features/auth/session";
import { processNextCoverArchiveJob, recoverInterruptedCoverArchiveJobs } from "@/features/backup/archive";
import { processNextStockRefreshJob, recoverInterruptedStockJob } from "@/features/inventory/service";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main(): Promise<void> {
  // Acquire before any recovery: another live worker must never be "recovered".
  const release = acquireWorkerLock(env.databasePath);
  process.once("exit", release);
  try {
    recoverInterruptedStockJob();
    recoverInterruptedCoverArchiveJobs();
    purgeExpiredSessions();
    logger.info("Bookshelf worker started");
    let lastCleanup = Date.now();
    while (!stopping) {
      let worked = false;
      worked = (await processNextStockRefreshJob()) || worked;
      if (!stopping) worked = (await processNextCoverArchiveJob()) || worked;
      if (Date.now() - lastCleanup > 60 * 60 * 1000) {
        purgeExpiredSessions();
        lastCleanup = Date.now();
      }
      if (!worked) await sleep(750);
    }
    logger.info("Bookshelf worker stopped");
  } finally {
    process.off("exit", release);
    release();
  }
}

main().catch((error) => {
  logger.error("Worker terminated", { error: error instanceof Error ? error.stack ?? error.message : String(error) });
  process.exitCode = 1;
});
