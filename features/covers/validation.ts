import { z } from "zod";

export const remoteCoverSchema = z.string().trim().url().max(2048).refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "표지 URL은 HTTP 또는 HTTPS 주소여야 합니다.");

export const MAX_COVER_BYTES = 8 * 1024 * 1024;
export const ALLOWED_COVER_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
