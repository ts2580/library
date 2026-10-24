import { requireApiUser } from "@/features/auth/authorization";
import { importExcelBackup } from "@/features/backup/excel";
import { assertSameOrigin } from "@/lib/http";
import { AppError, errorParams } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { boundedFormData } from "@/lib/form-data";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const data = await boundedFormData(request, 32 * 1024 * 1024 + 64 * 1024);
    const file = data.get("backupFile");
    if (!(file instanceof File)) throw new AppError("백업 파일을 선택해 주세요.");
    const result = await importExcelBackup(user.id, file);
    return Response.redirect(new URL(`/profile?message=${encodeURIComponent(result.summary)}`, request.url), 303);
  } catch (error) {
    if (!(error instanceof AppError) && !(error && typeof error === "object" && "issues" in error)) {
      logger.error("Excel backup import failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
    return Response.redirect(
      new URL(`/profile?${errorParams(error, "엑셀 백업을 가져오지 못했습니다.")}`, request.url),
      303
    );
  }
}
