import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
vi.mock("server-only", () => ({}));
const directory = fs.mkdtempSync(path.join(tmpdir(), "bookshelf-backup-recovery-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "bookshelf.sqlite");
const { sqlite } = await import("@/db");
const { createCoverUpload, saveCoverChunk, completeCoverUpload, getCoverUploadStatus, MAX_ARCHIVE_SIZE, CHUNK_SIZE } = await import("@/features/backup/upload");
const { processNextCoverArchiveJob, recoverStaleCoverAssemblies } = await import("@/features/backup/archive");
const uploadDir = (id: string) => path.join(directory, "uploads", id);
beforeEach(() => {
  vi.restoreAllMocks();
  sqlite.exec("DELETE FROM backup_upload_job; DELETE FROM member; INSERT INTO member(id,username,password_hash) VALUES(1,'backup','test'),(2,'other','test')");
  fs.rmSync(path.join(directory, "uploads"), { recursive: true, force: true });
  fs.mkdirSync(path.join(directory, "uploads"));
});
afterAll(() => { vi.restoreAllMocks(); sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });

function retainedJob(id: string, size = MAX_ARCHIVE_SIZE, owner = 1) {
  fs.mkdirSync(uploadDir(id)); fs.writeFileSync(path.join(uploadDir(id), "archive.zip"), "retained");
  sqlite.prepare(`INSERT INTO backup_upload_job(upload_id,owner_id,original_filename,total_size,total_chunks,status)
    VALUES(?,?,'failed.zip',?,?,'FAILED')`).run(id, owner, size, Math.ceil(size / CHUNK_SIZE));
}
function denyRemoval() {
  const remove = fs.rmSync;
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (String(target).includes("retained")) throw new Error("fixture EACCES");
    return remove(target, options);
  });
}

describe("cover upload disk reservations and recovery", () => {
  it("removes corrupt archives on failure and allows repeated retries", async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const content = Buffer.from("invalid ZIP fixture");
      const job = createCoverUpload(1, { filename: "bad.zip", totalSize: content.length, totalChunks: 1 });
      await saveCoverChunk(1, job.uploadId, 0, new Request("http://localhost", { method: "PUT", body: content }));
      await completeCoverUpload(1, job.uploadId);
      expect(await processNextCoverArchiveJob()).toBe(true);
      expect(getCoverUploadStatus(1, job.uploadId)).toMatchObject({ status: "FAILED", processing: false });
      expect(fs.existsSync(uploadDir(job.uploadId))).toBe(false);
    }
  });
  it("releases partial chunks when assembly fails", async () => {
    const job = createCoverUpload(1, { filename: "missing.zip", totalSize: 10, totalChunks: 1 });
    fs.writeFileSync(path.join(uploadDir(job.uploadId), "partial.tmp"), "partial");
    await expect(completeCoverUpload(1, job.uploadId)).rejects.toThrow("청크");
    expect(getCoverUploadStatus(1, job.uploadId).status).toBe("FAILED");
    expect(fs.existsSync(uploadDir(job.uploadId))).toBe(false);
  });
  it("counts retained failures against bytes, isolates owners, and retries cleanup", () => {
    retainedJob("retained-full"); denyRemoval();
    expect(() => createCoverUpload(1, { filename: "next.zip", totalSize: 1, totalChunks: 1 })).toThrow("2GiB");
    expect(createCoverUpload(2, { filename: "other.zip", totalSize: 1, totalChunks: 1 }).status).toBe("UPLOADING");
    vi.restoreAllMocks();
    expect(createCoverUpload(1, { filename: "retry.zip", totalSize: 1, totalChunks: 1 }).status).toBe("UPLOADING");
    expect(fs.existsSync(uploadDir("retained-full"))).toBe(false);
  });
  it("counts retained failures against the two-job limit", () => {
    retainedJob("retained-one", 1); retainedJob("retained-two", 1); denyRemoval();
    expect(() => createCoverUpload(1, { filename: "next.zip", totalSize: 1, totalChunks: 1 })).toThrow("2개");
  });
  it("expires stale assembly without touching fresh assembly or active worker restoration", () => {
    for (const [id, status, age] of [["stale", "ASSEMBLING", "-16 minutes"], ["fresh", "ASSEMBLING", "-1 minutes"], ["working", "PROCESSING", "-16 minutes"]]) {
      retainedJob(id, 1);
      sqlite.prepare("UPDATE backup_upload_job SET status=?,updated_at=datetime('now',?) WHERE upload_id=?").run(status, age, id);
    }
    recoverStaleCoverAssemblies();
    expect(getCoverUploadStatus(1, "stale")).toMatchObject({ status: "FAILED", processing: false });
    expect(fs.existsSync(uploadDir("stale"))).toBe(false);
    expect(getCoverUploadStatus(1, "fresh").status).toBe("ASSEMBLING");
    expect(getCoverUploadStatus(1, "working").status).toBe("PROCESSING");
    expect(fs.existsSync(uploadDir("fresh"))).toBe(true);
    expect(fs.existsSync(uploadDir("working"))).toBe(true);
  });
});
