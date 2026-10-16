import { setTimeout as sleep } from "node:timers/promises";
import "@/db";
import { logger } from "@/lib/logger";
import { purgeExpiredSessions } from "@/features/auth/session";
import { processNextCoverArchiveJob, recoverInterruptedCoverArchiveJobs } from "@/features/backup/archive";
import { processNextStockRefreshJob, recoverInterruptedStockJob } from "@/features/inventory/service";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main(): Promise<void> {
  recoverInterruptedStockJob();
  recoverInterruptedCoverArchiveJobs();
  purgeExpiredSessions();
  logger.info("Bookshelf worker started");
  let lastCleanup = Date.now();
  while (!stopping) {
    let worked = false;
    worked = (await processNextStockRefreshJob()) || worked;
    worked = (await processNextCoverArchiveJob()) || worked;
    if (Date.now() - lastCleanup > 60 * 60 * 1000) {
      purgeExpiredSessions();
      lastCleanup = Date.now();
    }
    if (!worked) await sleep(750);
  }
  logger.info("Bookshelf worker stopped");
}

main().catch((error) => {
  logger.error("Worker terminated", { error: error instanceof Error ? error.stack ?? error.message : String(error) });
  process.exitCode = 1;
});
