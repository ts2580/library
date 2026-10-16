import "server-only";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ZodError } from "zod";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const expectedHost = forwardedHost || requestUrl.host;
  const expectedProtocol = `${forwardedProto || requestUrl.protocol.replace(":", "")}:`;
  const supplied = new URL(origin);
  if (supplied.host !== expectedHost || supplied.protocol !== expectedProtocol) {
    throw new AppError("허용되지 않은 요청 출처입니다.", "INVALID_ORIGIN", 403);
  }
}

export function jsonError(error: unknown, fallback = "요청을 처리하지 못했습니다."): Response {
  if (error instanceof ZodError) {
    return Response.json({ success: false, message: error.issues[0]?.message ?? "입력값을 확인해 주세요." }, { status: 400 });
  }
  if (error instanceof AppError) {
    return Response.json({ success: false, message: error.message }, { status: error.status });
  }
  logger.error("Unhandled API error", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  return Response.json({ success: false, message: fallback }, { status: 500 });
}
