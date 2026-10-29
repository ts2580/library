import { setTimeout as sleep } from "node:timers/promises";
import "@/db";
import { env } from "@/lib/env";
import { acquireWorkerLock } from "./singleton";
import { logger } from "@/lib/logger";
import { purgeExpiredSessions } from "@/features/auth/session";
import { processNextCoverArchiveJob, recoverInterruptedCoverArchiveJobs, recoverStaleCoverAssemblies } from "@/features/backup/archive";
import { processNextStockRefreshJob, recoverInterruptedStockJob } from "@/features/inventory/service";
import { processNextMetadataEnrichmentJob } from "@/features/books/enrichment-job";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main(): Promise<void> {
  // Acquire before any recovery: another live worker must never be "recovered".
  const release = acquireWorkerLock(env.databasePath);
  process.once("exit", release);
  const assemblyRecovery = setInterval(() => {
    try { recoverStaleCoverAssemblies(); }
    catch (error) { logger.error("Stale cover assembly recovery failed", { error: String(error) }); }
  }, 30_000);
  assemblyRecovery.unref();
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
      if (!stopping) worked = (await processNextMetadataEnrichmentJob()) || worked;
      if (Date.now() - lastCleanup > 60 * 60 * 1000) {
        purgeExpiredSessions();
        lastCleanup = Date.now();
      }
      if (!worked) await sleep(750);
    }
    logger.info("Bookshelf worker stopped");
  } finally {
    clearInterval(assemblyRecovery);
    process.off("exit", release);
    release();
  }
}

main().catch((error) => {
  logger.error("Worker terminated", { error: error instanceof Error ? error.stack ?? error.message : String(error) });
  process.exitCode = 1;
});
