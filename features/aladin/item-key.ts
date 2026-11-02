import type { AladinBookItem } from "@/features/aladin/types";

/** Product identity is separate from ISBN: Aladin's K/U codes are not ISBNs. */
export function aladinItemKey(item: AladinBookItem): string | null {
  return item.itemId ? `item:${item.itemId}` : item.isbn13 ?? item.isbn;
}

export function normalizedIsbn(value: string | null | undefined): string | null {
  const key = value?.replace(/[-\s]/g, "").toUpperCase() ?? "";
  return /^(?:\d{13}|\d{9}[\dX])$/.test(key) ? key : null;
}

export function asIsbn13(value: string | null | undefined): string | null {
  const isbn = normalizedIsbn(value);
  if (!isbn || isbn.length === 13) return isbn;
  const prefix = `978${isbn.slice(0, 9)}`;
  const sum = [...prefix].reduce((total, char, i) => total + Number(char) * (i % 2 ? 3 : 1), 0);
  return prefix + (10 - sum % 10) % 10;
}
