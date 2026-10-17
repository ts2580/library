import "server-only";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net, { type LookupFunction } from "node:net";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { sqlite } from "@/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { abortable } from "@/lib/abortable";
import { safeFilename, trimToNull } from "@/lib/strings";
import { ALLOWED_COVER_TYPES, MAX_COVER_BYTES, remoteCoverSchema } from "@/features/covers/validation";

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function isPrivateIp(value: string): boolean {
  const kind = net.isIP(value);
  if (kind === 4) return isPrivateIpv4(value);
  if (kind === 6) {
    const normalized = value.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      return net.isIP(mapped) !== 4 || isPrivateIpv4(mapped);
    }
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:");
  }
  return true;
}

interface ResolvedHost {
  address: string;
  family: 4 | 6;
}

async function resolveRemoteHost(url: URL): Promise<ResolvedHost> {
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError("허용되지 않은 표지 URL 프로토콜입니다.");
  if (url.username || url.password) throw new AppError("사용자 정보가 포함된 표지 URL은 사용할 수 없습니다.");
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  const port = url.port || expectedPort;
  if (port !== expectedPort) throw new AppError(`표지 URL은 ${expectedPort} 포트만 사용할 수 있습니다.`);

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isPrivateIp(hostname)) throw new AppError("사설망 주소의 표지는 가져올 수 없습니다.");
    return { address: hostname, family: literalFamily as 4 | 6 };
  }

  if (hostname.toLowerCase().endsWith(".local")) throw new AppError("로컬 네트워크 호스트는 사용할 수 없습니다.");
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateIp(item.address))) {
    throw new AppError("사설망 또는 확인할 수 없는 주소의 표지는 가져올 수 없습니다.");
  }
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) throw new AppError("표지 호스트 주소를 확인할 수 없습니다.");
  return { address: selected.address, family: selected.family };
}

function requestRemote(url: URL, resolved: ResolvedHost, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [resolved]);
      else callback(null, resolved.address, resolved.family);
    };
    const requester = url.protocol === "https:" ? https.request : http.request;
    const request = requester(url, {
      method: "GET",
      signal,
      lookup,
      headers: {
        "user-agent": "Bookshelf/3.0 cover-fetcher",
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity"
      }
    }, resolve);
    request.setTimeout(10_000, () => request.destroy(new AppError("표지 다운로드 시간이 초과되었습니다.")));
    request.once("error", reject);
    request.end();
  });
}

async function readLimited(response: IncomingMessage): Promise<Buffer> {
  const declared = Number(response.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) {
    response.destroy();
    throw new AppError("표지 파일은 8MB 이하여야 합니다.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > MAX_COVER_BYTES) {
      response.destroy();
      throw new AppError("표지 파일은 8MB 이하여야 합니다.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function downloadRemoteCover(rawUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const { signal } = controller;
  // One budget for DNS, all redirects and body consumption (not just socket idle time).
  const timer = setTimeout(() => controller.abort(new AppError("표지 다운로드 전체 시간이 초과되었습니다.")), 30_000);
  timer.unref();
  try {
    let current = new URL(remoteCoverSchema.parse(rawUrl));
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      signal.throwIfAborted();
      const resolved = await abortable(resolveRemoteHost(current), signal);
      signal.throwIfAborted();
      const response = await requestRemote(current, resolved, signal);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        response.destroy();
        if (!location) throw new AppError("표지 URL 리디렉션 주소가 없습니다.");
        current = new URL(location, current);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new AppError(`표지를 가져오지 못했습니다. HTTP ${status}`);
      }
      const rawType = Array.isArray(response.headers["content-type"])
        ? response.headers["content-type"][0]
        : response.headers["content-type"];
      const type = rawType?.split(";")[0]?.trim().toLowerCase();
      if (type && !ALLOWED_COVER_TYPES.has(type)) {
        response.destroy();
        throw new AppError("이미지 형식의 표지만 등록할 수 있습니다.");
      }
      return await readLimited(response);
    }
    throw new AppError("표지 URL 리디렉션 횟수가 너무 많습니다.");
  } finally {
    clearTimeout(timer);
  }
}

async function fileBuffer(file: File): Promise<Buffer> {
  if (file.size <= 0) throw new AppError("표지 파일이 비어 있습니다.");
  if (file.size > MAX_COVER_BYTES) throw new AppError("표지 파일은 8MB 이하여야 합니다.");
  if (file.type && !ALLOWED_COVER_TYPES.has(file.type.toLowerCase())) {
    throw new AppError("JPG, PNG, GIF, WebP 표지만 업로드할 수 있습니다.");
  }
  return Buffer.from(await file.arrayBuffer());
}

async function normalizeAndSave(ownerId: number, buffer: Buffer, key: string): Promise<string> {
  const image = sharp(buffer, { animated: true, limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "gif", "webp"].includes(metadata.format)) {
    throw new AppError("지원하지 않는 이미지 파일입니다.");
  }
  const ownerDir = path.join(env.coversDir, String(ownerId));
  fs.mkdirSync(ownerDir, { recursive: true });
  const filename = `${safeFilename(key, "cover")}-${randomUUID()}.webp`;
  const target = path.join(ownerDir, filename);
  await image.resize({ width: 900, height: 1400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88, effort: 4 })
    .toFile(target);
  return `cover://${ownerId}/${filename}`;
}

export async function persistCover(input: {
  ownerId: number;
  key: string;
  file?: File | null;
  remoteUrl?: string | null;
}): Promise<string | null> {
  if (input.file && input.file.size > 0) {
    return normalizeAndSave(input.ownerId, await fileBuffer(input.file), input.key);
  }
  const remoteUrl = trimToNull(input.remoteUrl);
  if (!remoteUrl) return null;
  return normalizeAndSave(input.ownerId, await downloadRemoteCover(remoteUrl), input.key);
}

export function normalizeImportedCoverReference(ownerId: number, value: string | null): string | null {
  const reference = trimToNull(value);
  if (!reference) return null;
  if (/^https?:\/\//i.test(reference)) return reference;
  if (isCoverOwnedBy([reference], ownerId)) return reference;
  let rawName: string | null = null;
  if (reference.startsWith("cover://")) rawName = reference.slice("cover://".length).replaceAll("\\", "/");
  else if (reference.startsWith("/covers/")) rawName = reference.slice("/covers/".length).replaceAll("\\", "/");
  if (!rawName) return null;
  const filename = path.posix.basename(rawName);
  if (!filename || filename === "." || filename === ".." || filename.length > 255 || filename.includes("\0")) return null;
  return `cover://${ownerId}/${filename}`;
}

export function archiveEntryForReference(reference: string): string | null {
  const target = storedCoverPath(reference);
  return target ? `covers/${path.basename(target)}` : null;
}

export function storedCoverPath(reference: string): string | null {
  if (reference.startsWith("cover://")) {
    const relative = reference.slice("cover://".length);
    const target = path.resolve(env.coversDir, relative);
    return target.startsWith(path.resolve(env.coversDir) + path.sep) ? target : null;
  }
  if (reference.startsWith("/covers/")) {
    const basename = path.basename(reference.slice("/covers/".length));
    const target = path.resolve(env.coversDir, basename);
    return target.startsWith(path.resolve(env.coversDir) + path.sep) ? target : null;
  }
  return null;
}

export function coverReferenceFromRoute(parts: string[]): string[] {
  const decoded = parts;
  if (decoded.length === 1) return [`/covers/${decoded[0]}`];
  return [`cover://${decoded.join("/")}`];
}

export function isCoverOwnedBy(referenceCandidates: string[], ownerId: number): boolean {
  const scopedCandidates = referenceCandidates.filter((reference) => {
    if (!reference.startsWith("cover://")) return true;
    const [scope] = reference.slice("cover://".length).split("/");
    return scope === String(ownerId);
  });
  if (scopedCandidates.length === 0) return false;
  const placeholders = scopedCandidates.map(() => "?").join(",");
  const row = sqlite.prepare(`
    SELECT 1 AS ok
    FROM (
      SELECT b.cover AS cover FROM books b WHERE b.owner_id = ?
      UNION ALL
      SELECT bv.cover AS cover
      FROM book_volumes bv
      JOIN books b ON b.id = bv.book
      WHERE b.owner_id = ?
    ) owned
    WHERE owned.cover IN (${placeholders})
    LIMIT 1
  `).get(ownerId, ownerId, ...scopedCandidates) as { ok: number } | undefined;
  return row?.ok === 1;
}

export function deleteCoverIfUnused(reference: string | null): void {
  if (!reference) return;
  const target = storedCoverPath(reference);
  if (!target) return;
  const count = sqlite.prepare(`
    SELECT (
      (SELECT COUNT(*) FROM books WHERE cover = ?) +
      (SELECT COUNT(*) FROM book_volumes WHERE cover = ?)
    ) AS count
  `).get(reference, reference) as { count: number };
  if (count.count === 0 && fs.existsSync(/* turbopackIgnore: true */ target)) fs.rmSync(target, { force: true });
}
