import "server-only";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** Keep the failed job for status reporting, but release its disk reservation. */
export function discardFailedCoverUploadFiles(uploadId: string): boolean {
  try {
    fs.rmSync(path.join(env.uploadsDir, uploadId), { recursive: true, force: true });
    return true;
  } catch (error) {
    logger.warn("Failed cover upload files retained", { uploadId, error: String(error) });
    return false;
  }
}
