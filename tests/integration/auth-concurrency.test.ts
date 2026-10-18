import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${decodeURIComponent(url)}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => {
  const gate = control.gate?.method === "headers" ? control.gate : null;
  if (gate) { control.gate = null; gate.entered(); await gate.released; }
  return new Headers();
}, cookies: async () => ({ set() {}, delete() {}, get() {} }) }));
vi.mock("@/features/auth/authorization", () => ({ requireUser: async () => ({ id: 1, role: "ADMIN" }) }));
const control = vi.hoisted(() => ({ gate: null as null | { method: string; entered: () => void; released: Promise<void> } }));
vi.mock("@/features/auth/password", async (original) => {
  const actual = await original<typeof import("@/features/auth/password")>();
  const wrap = (method: "hashPassword" | "verifyPassword") => async (...args: any[]) => {
    const gate = control.gate?.method === method ? control.gate : null;
    if (gate) control.gate = null;
    const result = await (actual[method] as Function)(...args);
    if (gate) { gate.entered(); await gate.released; }
    return result;
  };
  return { ...actual, hashPassword: wrap("hashPassword"), verifyPassword: wrap("verifyPassword") };
});
const directory = fs.mkdtempSync(path.join(tmpdir(), "bookshelf-review-validation-"));
process.env.BOOKSHELF_DATA_DIR = directory;
process.env.BOOKSHELF_DB_PATH = path.join(directory, "fixture.sqlite");
const { sqlite } = await import("@/db");
const { hashPassword, verifyPassword } = await import("@/features/auth/password");
const { loginAction } = await import("@/features/auth/actions");
const { changePasswordAction } = await import("@/features/profile/actions");
const { createSession } = await import("@/features/auth/session");
const { signupSchema } = await import("@/features/auth/validation");
const { passwordChangeSchema } = await import("@/features/profile/validation");

beforeEach(() => {
  vi.restoreAllMocks(); control.gate = null;
  sqlite.exec("DELETE FROM backup_upload_job; DELETE FROM branchbook; DELETE FROM book_volumes; DELETE FROM books; DELETE FROM app_sessions; DELETE FROM member; INSERT INTO member(id,username,password_hash) VALUES(1,'review-user','fixture'); INSERT INTO books(id,name,owner_id) VALUES(1,'fixture',1);");
  fs.rmSync(path.join(directory, "covers"), { recursive: true, force: true });
  fs.mkdirSync(path.join(directory, "covers", "1"), { recursive: true });
  fs.mkdirSync(path.join(directory, "uploads"), { recursive: true });
});
afterAll(() => { vi.restoreAllMocks(); sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
function form(values: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; }
function pause(method: string) {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => entered = r);
  const released = new Promise<void>(r => release = r);
  control.gate = { method, entered, released };
  return { ready, release };
}
const oldPassword = "old-password-A1!", newPassword = "new-password-B2!";
const passwordChange = () => changePasswordAction(form({ currentPassword: oldPassword, newPassword, confirmPassword: newPassword }));
const storedHash = () => (sqlite.prepare("SELECT password_hash AS hash FROM member WHERE id=1").get() as any).hash;
const sessions = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM app_sessions WHERE member_id=1").get() as any).n;

it("checks credentials after awaiting the request headers, just before session insertion", async () => {
  sqlite.prepare("UPDATE member SET password_hash=? WHERE id=1").run(await hashPassword(oldPassword));
  const gate = pause("headers");
  const delayed = loginAction(form({ username: "review-user", password: oldPassword })).catch(e => e.message);
  await gate.ready; await expect(passwordChange()).rejects.toThrow("비밀번호를 변경");
  gate.release(); expect(await delayed).toContain("/login?error="); expect(sessions()).toBe(1);
});

it("rolls back the password update and session revocation if new session insertion fails", async () => {
  const hash = await hashPassword(oldPassword);
  sqlite.prepare("UPDATE member SET password_hash=? WHERE id=1").run(hash);
  await createSession(1, false, { expectedPasswordHash: hash });
  sqlite.exec("CREATE TEMP TRIGGER reject_fixture_session BEFORE INSERT ON app_sessions BEGIN SELECT RAISE(ABORT, 'fixture session failure'); END");
  try {
    await expect(passwordChange()).rejects.toThrow("fixture session failure");
    expect(storedHash()).toBe(hash); expect(sessions()).toBe(1);
  } finally { sqlite.exec("DROP TRIGGER reject_fixture_session"); }
});

it("rejects an outdated legacy rehash without overwriting the new password", async () => {
  sqlite.prepare("UPDATE member SET password_hash=? WHERE id=1").run(createHash("sha256").update(oldPassword).digest("hex"));
  const gate = pause("hashPassword");
  const login = loginAction(form({ username: "review-user", password: oldPassword })).catch(e => e.message);
  await gate.ready;
  await expect(passwordChange()).rejects.toThrow("비밀번호를 변경");
  expect(await verifyPassword(newPassword, storedHash())).toBe(true);
  gate.release(); expect(await login).toContain("/login?error=");
  expect(await verifyPassword(oldPassword, storedHash())).toBe(false);
  expect(await verifyPassword(newPassword, storedHash())).toBe(true);
  expect(sessions()).toBe(1);
});
it("rejects an in-flight BCrypt login after password change revoked sessions", async () => {
  sqlite.prepare("UPDATE member SET password_hash=? WHERE id=1").run(await hashPassword(oldPassword));
  const gate = pause("verifyPassword");
  const login = loginAction(form({ username: "review-user", password: oldPassword })).catch(e => e.message);
  await gate.ready; await expect(passwordChange()).rejects.toThrow("비밀번호를 변경");
  expect(sessions()).toBe(1);
  gate.release(); expect(await login).toContain("/login?error="); expect(sessions()).toBe(1);
  expect(await verifyPassword(oldPassword, storedHash())).toBe(false);
});
it("rejects over-72-byte new passwords at both schemas and the hashing boundary", async () => {
  const a = "가".repeat(24) + "A1!";
  expect(signupSchema.safeParse({ username: "review-user", password: a, confirmPassword: a, email: "" }).success).toBe(false);
  expect(passwordChangeSchema.safeParse({ currentPassword: "fixture", newPassword: a, confirmPassword: a }).success).toBe(false);
  await expect(hashPassword(a)).rejects.toThrow("72바이트");
  const boundary = "가".repeat(24);
  expect(Buffer.byteLength(boundary)).toBe(72);
  expect(await verifyPassword(boundary, await hashPassword(boundary))).toBe(true);
});

it("keeps full-string verification for long SHA-256 passwords without a lossy upgrade", async () => {
  const a = "가".repeat(24) + "A1!", b = "가".repeat(24) + "B2!";
  const legacy = createHash("sha256").update(a).digest("hex");
  sqlite.prepare("UPDATE member SET password_hash=? WHERE id=1").run(legacy);
  await expect(loginAction(form({ username: "review-user", password: a }))).rejects.toThrow("/dashboard");
  expect(storedHash()).toBe(legacy);
  await expect(loginAction(form({ username: "review-user", password: b }))).rejects.toThrow("/login?error=");
  expect(sessions()).toBe(1);
});

it("upgrades a short legacy password and issues its session together", async () => {
  sqlite.prepare("UPDATE member SET password_hash=? WHERE id=1").run(createHash("sha256").update(oldPassword).digest("hex"));
  await expect(loginAction(form({ username: "review-user", password: oldPassword }))).rejects.toThrow("/dashboard");
  expect(storedHash()).toMatch(/^\$2/);
  expect(await verifyPassword(oldPassword, storedHash())).toBe(true);
  expect(sessions()).toBe(1);
});

it("does not let a concurrent password change overwrite the first completed change", async () => {
  sqlite.prepare("UPDATE member SET password_hash=? WHERE id=1").run(await hashPassword(oldPassword));
  const gate = pause("hashPassword");
  const delayed = changePasswordAction(form({currentPassword:oldPassword,newPassword:"delayed-password",confirmPassword:"delayed-password"})).catch(e => e.message);
  await gate.ready; await expect(passwordChange()).rejects.toThrow("비밀번호를 변경");
  gate.release(); expect(await delayed).toContain("비밀번호가 변경");
  expect(await verifyPassword(newPassword, storedHash())).toBe(true);
  expect(sessions()).toBe(1);
});
