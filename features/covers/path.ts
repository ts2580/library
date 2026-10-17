import { normalizeHttpUrl } from "@/lib/urls";

export function coverSource(value: string | null | undefined): string | null {
  if (!value) return null;
  const remote = normalizeHttpUrl(value);
  if (remote) return remote;
  if (value.startsWith("/api/covers/")) return value;
  if (value.startsWith("cover://")) {
    return `/api/covers/${value.slice("cover://".length).split("/").map(encodeURIComponent).join("/")}`;
  }
  if (value.startsWith("/covers/")) {
    return `/api/covers/${encodeURIComponent(value.slice("/covers/".length))}`;
  }
  return null;
}
