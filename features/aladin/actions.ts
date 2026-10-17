"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/authorization";
import { importAladinItem } from "@/features/aladin/import";
import { errorMessage } from "@/lib/errors";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function importAladinItemAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  let result: { bookId: number; volumeId: number };
  try {
    result = await importAladinItem(user.id, {
      targetBookId: value(formData, "targetBookId"),
      title: value(formData, "title"),
      author: value(formData, "author"),
      description: value(formData, "description"),
      isbn13: value(formData, "isbn13"),
      cover: value(formData, "cover"),
      price: value(formData, "price"),
      link: value(formData, "link"),
      pubDate: value(formData, "pubDate"),
      categoryName: value(formData, "categoryName"),
      sideStory: formData.get("sideStory")
    });
  } catch (error) {
    const query = value(formData, "returnQuery");
    const bookId = value(formData, "returnBookId");
    const params = new URLSearchParams({ query, error: errorMessage(error) });
    if (bookId) params.set("bookId", bookId);
    redirect(`/aladin/search?${params.toString()}`);
  }
  revalidatePath("/books");
  revalidatePath(`/books/${result.bookId}`);
  revalidatePath("/dashboard");
  redirect(`/books/${result.bookId}?message=${encodeURIComponent("알라딘 항목을 등록했습니다.")}`);
}
