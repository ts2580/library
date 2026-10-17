export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > 2048) return null;
  try {
    const url = new URL(input);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string | null): boolean {
  return value == null || normalizeHttpUrl(value) != null;
}
