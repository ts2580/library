import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import archiver from "archiver";
import unzipper from "unzipper";

vi.mock("server-only", () => ({}));
const directory = fs.mkdtempSync(path.join(tmpdir(), "bookshelf-cover-integrity-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "fixture.sqlite");
const { sqlite } = await import("@/db");
const { createCoverArchive, processNextCoverArchiveJob } = await import("@/features/backup/archive");
const { createCoverUpload, saveCoverChunk, completeCoverUpload, getCoverUploadStatus } = await import("@/features/backup/upload");
const { exportExcelBackup, importExcelBackup } = await import("@/features/backup/excel");
const { storedCoverPath, archiveEntryForReference } = await import("@/features/covers/service");

beforeEach(() => {
  vi.restoreAllMocks();
  sqlite.exec("DELETE FROM backup_upload_job; DELETE FROM branchbook; DELETE FROM book_volumes; DELETE FROM books; DELETE FROM member; INSERT INTO member(id,username,password_hash) VALUES(1,'backup','fixture'),(2,'other','fixture'); INSERT INTO books(id,name,owner_id,cover) VALUES(1,'fixture',1,'/covers/same.webp'); INSERT INTO book_volumes(id,book,name,cover) VALUES(1,1,'volume','cover://1/same.webp');");
  fs.rmSync(path.join(directory, "covers"), { recursive: true, force: true });
  fs.mkdirSync(path.join(directory, "covers", "1"), { recursive: true });
});
afterAll(() => { vi.restoreAllMocks(); sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function collect(stream: AsyncIterable<Buffer>) { const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part)); return Buffer.concat(parts); }
async function image(color: string) { return sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).webp().toBuffer(); }
async function sources() {
  const originals = new Map([["/covers/same.webp", await image("red")], ["cover://1/same.webp", await image("blue")]]);
  for (const [ref, bytes] of originals) fs.writeFileSync(storedCoverPath(ref)!, bytes);
  return originals;
}
async function restore(zip: Buffer, owner = 1) {
  const job = createCoverUpload(owner, { filename: "fixture.zip", totalSize: zip.length, totalChunks: 1 });
  await saveCoverChunk(owner, job.uploadId, 0, new Request("http://localhost", { method: "PUT", body: new Uint8Array(zip) }));
  await completeCoverUpload(owner, job.uploadId); expect(await processNextCoverArchiveJob()).toBe(true);
  return getCoverUploadStatus(owner, job.uploadId);
}
async function zipFiles(entries: Array<[string, Buffer | string]>) {
  const stream = new PassThrough(); const zip = archiver("zip"); zip.pipe(stream);
  const result = collect(stream);
  for (const [name, bytes] of entries) zip.append(bytes, { name });
  await zip.finalize(); return result;
}
const bookCover = (owner = 1) => (sqlite.prepare("SELECT cover FROM books WHERE owner_id=?").get(owner) as { cover: string }).cover;

it("round-trips two same-basename covers with distinct ZIP entries and byte hashes", async () => {
  const originals = await sources(); const zip = await collect(createCoverArchive(1));
  const opened = await unzipper.Open.buffer(zip);
  const manifest = JSON.parse((await opened.files.find(f => f.path === "manifest.json")!.buffer()).toString());
  expect(manifest.version).toBe(3); expect(manifest.files).toHaveLength(2);
  expect(new Set(manifest.files.map((f: {entry:string}) => f.entry)).size).toBe(2);
  for (const [ref] of originals) fs.rmSync(storedCoverPath(ref)!);
  expect(await restore(zip)).toMatchObject({status:"COMPLETED",message:"표지 2개 복원, 0개 건너뜀"});
  for (const [ref, bytes] of originals) expect(digest(fs.readFileSync(storedCoverPath(ref)!))).toBe(digest(bytes));
});

it.each([1, 2])("keeps both source identities when XLSX and ZIP are restored into an empty owner %s", async owner => {
  const originals = await sources();
  const excel = await exportExcelBackup(1, "backup"), zip = await collect(createCoverArchive(1));
  sqlite.exec("DELETE FROM book_volumes; DELETE FROM books");
  fs.rmSync(path.join(directory,"covers"),{recursive:true,force:true});
  await importExcelBackup(owner, new File([new Uint8Array(excel)], "fixture.xlsx"));
  expect(await restore(zip, owner)).toMatchObject({status:"COMPLETED",message:"표지 2개 복원, 0개 건너뜀"});
  const refs = [bookCover(owner), (sqlite.prepare("SELECT cover FROM book_volumes").get() as {cover:string}).cover];
  expect(new Set(refs).size).toBe(2);
  expect(refs.every(ref=>ref.startsWith(`cover://${owner}/`))).toBe(true);
  for (const [index, bytes] of [...originals.values()].entries()) expect(digest(fs.readFileSync(storedCoverPath(refs[index])!))).toBe(digest(bytes));
  // Repeat imports retain the same references and valid files.
  await importExcelBackup(owner, new File([new Uint8Array(excel)], "fixture.xlsx"));
  expect((await restore(zip, owner)).status).toBe("COMPLETED");
  expect(bookCover(owner)).toBe(refs[0]);
});

it.each([true,false])("reads legacy v2 ZIPs with a trailing manifest=%s", async manifest => {
  sqlite.exec("DELETE FROM book_volumes; UPDATE books SET cover='cover://1/legacy.webp'");
  const bytes = await image("green"), reference = bookCover();
  const entries: Array<[string,Buffer|string]> = [["covers/legacy.webp", bytes]];
  if (manifest) entries.push(["manifest.json", JSON.stringify({version:2,files:[{reference,entry:"covers/legacy.webp"}]})]);
  expect((await restore(await zipFiles(entries))).status).toBe("COMPLETED");
  expect(digest(fs.readFileSync(storedCoverPath(reference)!))).toBe(digest(bytes));
});

it("cleans a partial temporary write after ENOSPC and succeeds on retry", async () => {
  await sources(); const zip = await collect(createCoverArchive(1));
  const target = storedCoverPath(bookCover())!; fs.rmSync(target);
  const write = fs.writeFileSync;
  const spy = vi.spyOn(fs,"writeFileSync").mockImplementation((file,data,options)=>{
    if (String(file).startsWith(target+".") && String(file).endsWith(".restore.tmp")) {
      write(file,Buffer.from(data as Uint8Array).subarray(0,5),options); throw Object.assign(new Error("fixture ENOSPC"),{code:"ENOSPC"});
    }
    return write(file,data,options);
  });
  expect((await restore(zip)).status).toBe("FAILED"); spy.mockRestore();
  expect(fs.existsSync(target)).toBe(false);
  expect(fs.readdirSync(path.dirname(target)).some(file=>file.endsWith(".restore.tmp"))).toBe(false);
  expect((await restore(zip)).status).toBe("COMPLETED");
  expect(await sharp(target).metadata()).toMatchObject({format:"webp"});
});

it("repairs a pre-existing truncated final file instead of marking it generated", async () => {
  const originals=await sources(), zip=await collect(createCoverArchive(1));
  const target=storedCoverPath(bookCover())!; fs.writeFileSync(target,Buffer.from("bad"));
  expect((await restore(zip)).status).toBe("COMPLETED");
  expect(digest(fs.readFileSync(target))).toBe(digest(originals.get(bookCover())!));
  expect(sqlite.prepare("SELECT cover_generated FROM books WHERE id=1").get()).toEqual({cover_generated:1});
});

it("preserves a valid target published concurrently before link", async () => {
  await sources(); const zip=await collect(createCoverArchive(1));
  const target=storedCoverPath(bookCover())!, concurrent=await image("yellow"); fs.rmSync(target);
  const link=fs.linkSync;
  const spy=vi.spyOn(fs,"linkSync").mockImplementation((source,destination)=>{
    if(String(destination)===target) fs.writeFileSync(target,concurrent,{flag:"wx"});
    return link(source,destination);
  });
  expect((await restore(zip)).status).toBe("COMPLETED"); spy.mockRestore();
  expect(digest(fs.readFileSync(target))).toBe(digest(concurrent));
});

it("rejects a manifest mapping outside the current owner's DB references", async () => {
  const foreign=await image("purple"); sqlite.exec("DELETE FROM book_volumes; UPDATE books SET cover=NULL");
  const reference="cover://2/foreign.webp", entry=archiveEntryForReference(reference)!;
  const zip=await zipFiles([[entry,foreign],["manifest.json",JSON.stringify({version:3,files:[{reference,entry}]})]]);
  expect((await restore(zip)).status).toBe("COMPLETED");
  expect(fs.existsSync(storedCoverPath(reference)!)).toBe(false);
});
