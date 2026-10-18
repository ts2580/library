import "server-only";
import { compare, hash } from "bcryptjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { fitsBcrypt, PASSWORD_BYTE_MESSAGE } from "@/features/auth/password-policy";

const LEGACY_SHA256 = /^[0-9a-fA-F]{64}$/;
const BCRYPT_PREFIX = "{bcrypt}";

function normalizedBcrypt(value: string): string {
  return value.startsWith(BCRYPT_PREFIX) ? value.slice(BCRYPT_PREFIX.length) : value;
}

export function isLegacyPasswordHash(value: string): boolean {
  return LEGACY_SHA256.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  if (!fitsBcrypt(password)) throw new Error(PASSWORD_BYTE_MESSAGE);
  return hash(password, 12);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const normalized = normalizedBcrypt(storedHash);
  if (/^\$2[aby]\$/.test(normalized)) return compare(password, normalized);
  if (!isLegacyPasswordHash(storedHash)) return false;
  const actual = Buffer.from(createHash("sha256").update(password, "utf8").digest("hex"), "utf8");
  const expected = Buffer.from(storedHash.toLowerCase(), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
