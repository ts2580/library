import "server-only";
import { LegacyCleanup } from "@/features/migration/legacy-cleanup";
import { env } from "@/lib/env";

export function createLegacyCleanupService() {
  return new LegacyCleanup({ dataRoot: env.dataRoot, sourceDir: env.legacyDataDir, dataDir: env.dataDir, databasePath: env.databasePath });
}
