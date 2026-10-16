"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireUser } from "@/features/auth/authorization";
import { hashPassword, verifyPassword } from "@/features/auth/password";
import { createSession, destroyAllSessions } from "@/features/auth/session";
import { passwordChangeSchema, profileSchema } from "@/features/profile/validation";
import { regeneratePendingCovers } from "@/features/covers/regeneration";
import { errorMessage } from "@/lib/errors";

function v(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function fail(message: string): never {
  redirect(`/profile?error=${encodeURIComponent(message)}`);
}

export async function updateProfileAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    name: v(formData, "name"),
    email: v(formData, "email"),
    description: v(formData, "description")
  });
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
  db.update(members).set({
    name: parsed.data.name || null,
    email: parsed.data.email || null,
    description: parsed.data.description || null
  }).where(eq(members.id, user.id)).run();
  redirect(`/profile?message=${encodeURIComponent("프로필을 저장했습니다.")}`);
}

export async function changePasswordAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  const parsed = passwordChangeSchema.safeParse({
    currentPassword: v(formData, "currentPassword"),
    newPassword: v(formData, "newPassword"),
    confirmPassword: v(formData, "confirmPassword")
  });
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
  const member = db.select().from(members).where(eq(members.id, user.id)).get();
  if (!member || !(await verifyPassword(parsed.data.currentPassword, member.passwordHash))) {
    fail("현재 비밀번호가 올바르지 않습니다.");
  }
  db.update(members).set({ passwordHash: await hashPassword(parsed.data.newPassword) })
    .where(eq(members.id, user.id)).run();
  await destroyAllSessions(user.id);
  await createSession(user.id, false);
  redirect(`/profile?message=${encodeURIComponent("비밀번호를 변경하고 다른 로그인 세션을 종료했습니다.")}`);
}

export async function regenerateCoversAction(): Promise<never> {
  const user = await requireUser();
  try {
    const result = await regeneratePendingCovers(user.id);
    revalidatePath("/books");
    revalidatePath("/dashboard");
    redirect(`/profile?message=${encodeURIComponent(result.summary)}`);
  } catch (error) {
    redirect(`/profile?error=${encodeURIComponent(errorMessage(error, "커버를 재생성하지 못했습니다."))}`);
  }
}
