export function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  return normalized.length > 0 ? normalized : null;
}

export function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function safeFilename(value: string, fallback = "file"): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return normalized || fallback;
}

export function escapeLike(value: string): string {
  return value.normalize("NFC").replace(/[!%_]/g, (match) => `!${match}`);
}
