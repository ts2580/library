import "server-only";
import { persistCover } from "@/features/covers/service";
import { logger } from "@/lib/logger";

// An unavailable upstream image must not discard a validated book selection.
// The caller retains originalUrl and cover_generated=0 for later regeneration.
export async function persistAladinCover(ownerId: number, key: string, remoteUrl: string | null): Promise<string | null> {
  try { return await persistCover({ ownerId, key, remoteUrl }); }
  catch (error) {
    logger.warn("Aladin cover deferred", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
