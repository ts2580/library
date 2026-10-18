import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { appSessions, members } from "@/db/schema";
import { db, sqlite } from "@/db";
import { env } from "@/lib/env";
import type { SessionUser } from "@/features/auth/types";

const COOKIE_NAME = "bookshelf_session";

export class CredentialsChangedError extends Error {
  constructor() { super("비밀번호가 변경되었습니다. 다시 로그인해 주세요."); }
}

type SessionCredentials = {
  expectedPasswordHash: string;
  nextPasswordHash?: string;
  revokeExisting?: boolean;
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function userAgentHash(value: string | null): string | null {
  return value ? createHash("sha256").update(value, "utf8").digest("hex") : null;
}

function useSecureCookie(requestHeaders: Headers): boolean {
  if (env.BOOKSHELF_COOKIE_SECURE === "true") return true;
  if (env.BOOKSHELF_COOKIE_SECURE === "false") return false;
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) return forwardedProto === "https";
  const forwarded = requestHeaders.get("forwarded")?.toLowerCase() ?? "";
  return /(?:^|;)\s*proto=https(?:;|$)/.test(forwarded);
}

export async function createSession(memberId: number, remember: boolean, credentials: SessionCredentials): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (remember
    ? env.BOOKSHELF_REMEMBER_DAYS * 24 * 60 * 60 * 1000
    : env.BOOKSHELF_SESSION_HOURS * 60 * 60 * 1000));
  const requestHeaders = await headers();
  const cookieStore = await cookies();

  // No await between the credential check, optional rotation/revocation and INSERT.
  sqlite.transaction(() => {
    const current = db.select({ hash: members.passwordHash }).from(members).where(eq(members.id, memberId)).get();
    if (!current || current.hash !== credentials.expectedPasswordHash) throw new CredentialsChangedError();
    if (credentials.nextPasswordHash) {
      db.update(members).set({ passwordHash: credentials.nextPasswordHash }).where(eq(members.id, memberId)).run();
    }
    if (credentials.revokeExisting) db.delete(appSessions).where(eq(appSessions.memberId, memberId)).run();
    db.insert(appSessions).values({
      idHash: tokenHash(token),
      memberId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgentHash: userAgentHash(requestHeaders.get("user-agent"))
    }).run();
  }).immediate();

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookie(requestHeaders),
    path: "/",
    expires: expiresAt,
    priority: "high"
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) db.delete(appSessions).where(eq(appSessions.idHash, tokenHash(token))).run();
  cookieStore.delete(COOKIE_NAME);
}


export async function destroyAllSessions(memberId: number): Promise<void> {
  db.delete(appSessions).where(eq(appSessions.memberId, memberId)).run();
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

async function loadCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const now = new Date().toISOString();
  const row = db
    .select({
      id: members.id,
      username: members.username,
      email: members.email,
      name: members.name,
      description: members.description,
      role: members.role,
      sessionHash: appSessions.idHash,
      lastSeenAt: appSessions.lastSeenAt
    })
    .from(appSessions)
    .innerJoin(members, eq(appSessions.memberId, members.id))
    .where(and(eq(appSessions.idHash, tokenHash(token)), gt(appSessions.expiresAt, now)))
    .get();

  // Server Components may read cookies but cannot mutate them during rendering.
  if (!row) return null;

  if (Date.now() - new Date(row.lastSeenAt).getTime() > 5 * 60 * 1000) {
    db.update(appSessions)
      .set({ lastSeenAt: now })
      .where(eq(appSessions.idHash, row.sessionHash))
      .run();
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    description: row.description,
    role: row.role
  };
}

export const getCurrentUser = cache(loadCurrentUser);

export function purgeExpiredSessions(): number {
  return sqlite.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").run(new Date().toISOString()).changes;
}
