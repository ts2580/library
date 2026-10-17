export class AppError extends Error {
  constructor(
    message: string,
    readonly code = "APP_ERROR",
    readonly status = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "요청한 데이터를 찾을 수 없습니다.") {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "접근 권한이 없습니다.") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

interface ValidationIssueLike {
  message?: unknown;
}

function firstValidationIssue(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("issues" in error)) return null;
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;
  const first = issues.find((issue): issue is ValidationIssueLike => Boolean(issue) && typeof issue === "object");
  return typeof first?.message === "string" && first.message.trim() ? first.message : null;
}

export function errorMessage(error: unknown, fallback = "처리 중 오류가 발생했습니다."): string {
  if (error instanceof AppError && error.message) return error.message;
  return firstValidationIssue(error) ?? fallback;
}
