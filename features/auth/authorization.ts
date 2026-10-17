import "server-only";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { books } from "@/db/schema";
import { db } from "@/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getCurrentUser } from "@/features/auth/session";
import type { SessionUser } from "@/features/auth/types";

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("로그인이 필요합니다.", "UNAUTHORIZED", 401);
  return user;
}

export async function requireApiAdmin(): Promise<SessionUser> {
  const user = await requireApiUser();
  if (user.role !== "ADMIN") throw new ForbiddenError("관리자 권한이 필요합니다.");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound();
  return user;
}

export function assertBookOwnership(bookId: number, ownerId: number): void {
  const row = db.select({ id: books.id }).from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)))
    .get();
  if (!row) throw new NotFoundError("책을 찾을 수 없거나 접근 권한이 없습니다.");
}
