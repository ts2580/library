"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/authorization";
import { db } from "@/db";
import { bookCategories } from "@/db/schema";

export async function createCategoryAction(raw: string): Promise<{ name?: string; error?: string }> {
  await requireUser();
  const parsed = z.string().trim().min(1).max(120).safeParse(raw);
  if (!parsed.success) return { error: "카테고리 이름은 1~120자로 입력하세요." };
  db.insert(bookCategories).values({ name: parsed.data }).onConflictDoNothing().run();
  revalidatePath("/books");
  return { name: parsed.data };
}
