import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { requireApiUser } from "@/features/auth/authorization";
import { coverReferenceFromRoute, isCoverOwnedBy, storedCoverPath } from "@/features/covers/service";
import { AppError } from "@/lib/errors";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const user = await requireApiUser();
    const { path: parts } = await params;
    if (!parts?.length) throw new AppError("표지 경로가 없습니다.", "NOT_FOUND", 404);
    const candidates = coverReferenceFromRoute(parts);
    if (!isCoverOwnedBy(candidates, user.id)) throw new AppError("표지에 접근할 수 없습니다.", "NOT_FOUND", 404);
    const reference = candidates.find((candidate) => {
      const target = storedCoverPath(candidate);
      return target != null && fs.existsSync(target) && fs.statSync(target).isFile();
    });
    const target = reference ? storedCoverPath(reference) : null;
    if (!target) throw new AppError("표지 파일을 찾을 수 없습니다.", "NOT_FOUND", 404);
    const stat = fs.statSync(target);
    const body = Readable.toWeb(fs.createReadStream(target)) as ReadableStream;
    return new Response(body, {
      headers: {
        "content-type": contentType(target),
        "content-length": String(stat.size),
        "cache-control": "private, max-age=86400, immutable",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) { return jsonError(error); }
}
