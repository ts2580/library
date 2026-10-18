/** Aladin's Big response can still point to a 200px image. */
export function largeAladinCover(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "image.aladin.co.kr") return value;
    url.pathname = url.pathname.replace(/\/(?:coversum|cover200)\//gi, "/cover500/");
    return url.toString();
  } catch {
    return value;
  }
}
