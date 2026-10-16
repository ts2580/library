"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/authorization";
import { addVolume, createBook, deleteBook, deleteVolume, updateBook, updateVolume } from "@/features/books/service";
import { errorMessage } from "@/lib/errors";
import { entityIdSchema } from "@/features/books/validation";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function file(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function entityId(formData: FormData, key: string): number {
  return entityIdSchema.parse(text(formData, key));
}

function entityIdOrRedirect(formData: FormData, key: string, fallbackPath: string): number {
  try {
    return entityId(formData, key);
  } catch (error) {
    redirect(`${fallbackPath}?error=${encodeURIComponent(errorMessage(error))}`);
  }
}

function bookPayload(formData: FormData) {
  return {
    name: text(formData, "name"),
    author: text(formData, "author"),
    description: text(formData, "description"),
    type: text(formData, "type"),
    totalVolume: text(formData, "totalVolume"),
    coverUrl: text(formData, "coverUrl")
  };
}

function volumePayload(formData: FormData) {
  return {
    name: text(formData, "name"),
    seq: text(formData, "seq"),
    isbn13: text(formData, "isbn13"),
    author: text(formData, "author"),
    price: text(formData, "price"),
    description: text(formData, "description"),
    link: text(formData, "link"),
    pubDate: text(formData, "pubDate"),
    coverUrl: text(formData, "coverUrl"),
    isPurchased: formData.get("isPurchased"),
    noNeedToBuy: formData.get("noNeedToBuy")
  };
}

export async function createBookAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  let id: number;
  try {
    id = await createBook(user.id, bookPayload(formData), file(formData, "coverFile"));
  } catch (error) {
    redirect(`/books?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath("/books");
  revalidatePath("/dashboard");
  redirect(`/books/${id}?message=${encodeURIComponent("책을 추가했습니다.")}`);
}

export async function updateBookAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  const id = entityIdOrRedirect(formData, "bookId", "/books");
  try {
    await updateBook(user.id, id, bookPayload(formData), file(formData, "coverFile"));
  } catch (error) {
    redirect(`/books/${id}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(`/books/${id}`);
  revalidatePath("/books");
  redirect(`/books/${id}?message=${encodeURIComponent("책 정보를 저장했습니다.")}`);
}

export async function deleteBookAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  const id = entityIdOrRedirect(formData, "bookId", "/books");
  try {
    deleteBook(user.id, id);
  } catch (error) {
    redirect(`/books/${id}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath("/books");
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  redirect(`/books?message=${encodeURIComponent("책을 삭제했습니다.")}`);
}

export async function addVolumeAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  const bookId = entityIdOrRedirect(formData, "bookId", "/books");
  try {
    await addVolume(user.id, bookId, volumePayload(formData), file(formData, "coverFile"));
  } catch (error) {
    redirect(`/books/${bookId}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/books");
  revalidatePath("/dashboard");
  redirect(`/books/${bookId}?message=${encodeURIComponent("권을 추가했습니다.")}`);
}

export async function updateVolumeAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  const bookId = entityIdOrRedirect(formData, "bookId", "/books");
  const volumeId = entityIdOrRedirect(formData, "volumeId", `/books/${bookId}`);
  try {
    await updateVolume(user.id, bookId, volumeId, volumePayload(formData), file(formData, "coverFile"));
  } catch (error) {
    redirect(`/books/${bookId}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  redirect(`/books/${bookId}?message=${encodeURIComponent("권 정보를 저장했습니다.")}`);
}

export async function deleteVolumeAction(formData: FormData): Promise<never> {
  const user = await requireUser();
  const bookId = entityIdOrRedirect(formData, "bookId", "/books");
  const volumeId = entityIdOrRedirect(formData, "volumeId", `/books/${bookId}`);
  try {
    deleteVolume(user.id, bookId, volumeId);
  } catch (error) {
    redirect(`/books/${bookId}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/books");
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  redirect(`/books/${bookId}?message=${encodeURIComponent("권을 삭제했습니다.")}`);
}
