"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/authorization";
import { addCategory } from "@/features/books/categories";
import { errorCode, errorMessage } from "@/lib/errors";

export async function createCategoryAction(raw: string): Promise<{ name?: string; error?: string; code?: string }> {
  await requireUser();
  let name: string;
  try { name = addCategory(raw); }
  catch (error) { return { error: errorMessage(error, "카테고리를 추가하지 못했습니다."), code: errorCode(error) }; }
  revalidatePath("/books");
  revalidatePath("/profile");
  return { name };
}
