import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/features/auth/authorization", () => ({ requireUser: vi.fn() }));
vi.mock("@/features/books/categories", () => ({ addCategory: vi.fn(), removeCategory: vi.fn() }));
vi.mock("@/features/auth/password", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ createSession: vi.fn(), destroyAllSessions: vi.fn() }));
vi.mock("@/features/covers/regeneration", () => ({ regeneratePendingCovers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${decodeURIComponent(url)}`); } }));

import { requireUser } from "@/features/auth/authorization";
import { addCategory, removeCategory } from "@/features/books/categories";
import { addProfileCategoryAction, deleteProfileCategoryAction } from "@/features/profile/actions";

const user = { id: 2, username: "fixture-user", name: null, email: null, description: null, role: "USER" as const };
const data = new FormData(); data.set("category", "공용 미사용 분류");
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireUser).mockResolvedValue(user); });

it("rejects a regular user's direct deletion of a shared category", async () => {
  await expect(deleteProfileCategoryAction(data)).rejects.toThrow("관리자");
  expect(removeCategory).not.toHaveBeenCalled();
});
it("allows an administrator to delete an unused shared category", async () => {
  vi.mocked(requireUser).mockResolvedValue({ ...user, role: "ADMIN" });
  await expect(deleteProfileCategoryAction(data)).rejects.toThrow("카테고리를 삭제했습니다");
  expect(removeCategory).toHaveBeenCalledWith("공용 미사용 분류");
});
it("retains category creation for authenticated regular users", async () => {
  await expect(addProfileCategoryAction(data)).rejects.toThrow("카테고리를 추가했습니다");
  expect(addCategory).toHaveBeenCalledWith("공용 미사용 분류");
});
it("requires login before any category mutation", async () => {
  vi.mocked(requireUser).mockRejectedValue(new Error("REDIRECT:/login"));
  await expect(deleteProfileCategoryAction(data)).rejects.toThrow("/login");
  expect(removeCategory).not.toHaveBeenCalled();
});
