"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { members } from "@/db/schema";
import { createSession, destroySession } from "@/features/auth/session";
import { hashPassword, isLegacyPasswordHash, verifyPassword } from "@/features/auth/password";
import { loginSchema, signupSchema } from "@/features/auth/validation";
import { env } from "@/lib/env";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function withError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function loginAction(formData: FormData): Promise<never> {
  const parsed = loginSchema.safeParse({
    username: value(formData, "username"),
    password: value(formData, "password"),
    remember: formData.get("remember")
  });
  if (!parsed.success) withError("/login", parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.");

  const member = db.select().from(members).where(eq(members.username, parsed.data.username)).get();
  const valid = member ? await verifyPassword(parsed.data.password, member.passwordHash) : false;
  if (!member || !valid) withError("/login", "아이디 또는 비밀번호가 올바르지 않습니다.");

  if (isLegacyPasswordHash(member.passwordHash)) {
    db.update(members)
      .set({ passwordHash: await hashPassword(parsed.data.password) })
      .where(eq(members.id, member.id))
      .run();
  }

  await createSession(member.id, parsed.data.remember);
  redirect("/dashboard");
}

export async function signupAction(formData: FormData): Promise<never> {
  if (!env.REGISTRATION) withError("/login", "현재 회원가입이 비활성화되어 있습니다.");
  const parsed = signupSchema.safeParse({
    username: value(formData, "username"),
    password: value(formData, "password"),
    confirmPassword: value(formData, "confirmPassword"),
    email: value(formData, "email"),
    name: value(formData, "name"),
    description: value(formData, "description")
  });
  if (!parsed.success) withError("/signup", parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.");

  const passwordHash = await hashPassword(parsed.data.password);
  let id: number;
  try {
    const transaction = sqlite.transaction(() => {
      const exists = db.select({ id: members.id }).from(members).where(eq(members.username, parsed.data.username)).get();
      if (exists) throw new Error("USERNAME_EXISTS");
      const count = db.select({ count: sql<number>`count(*)` }).from(members).get()?.count ?? 0;
      const result = db.insert(members).values({
        username: parsed.data.username,
        passwordHash,
        email: parsed.data.email || null,
        name: parsed.data.name || null,
        description: parsed.data.description || null,
        role: count === 0 ? "ADMIN" : "USER"
      }).run();
      return Number(result.lastInsertRowid);
    });
    id = transaction.immediate();
  } catch (error) {
    if (error instanceof Error && (error.message === "USERNAME_EXISTS" || /UNIQUE constraint failed: member\.username/.test(error.message))) {
      withError("/signup", "이미 사용 중인 아이디입니다.");
    }
    throw error;
  }
  await createSession(id, false);
  redirect("/dashboard?message=" + encodeURIComponent("계정이 생성되었습니다."));
}

export async function logoutAction(): Promise<never> {
  await destroySession();
  redirect("/login");
}
