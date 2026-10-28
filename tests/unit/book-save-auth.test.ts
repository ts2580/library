import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/features/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/features/books/service", () => ({
  addVolume: vi.fn(), createBook: vi.fn(), deleteBook: vi.fn(), deleteVolume: vi.fn(),
  deleteVolumes: vi.fn(), updateBook: vi.fn(), updateVolume: vi.fn()
}));
vi.mock("@/features/books/enrichment", () => ({ enrichMissingBookInfo: vi.fn() }));
vi.mock("@/features/inventory/queries", () => ({ getBranchInventory: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); } }));

import { getCurrentUser } from "@/features/auth/session";
import { updateBook, updateVolume } from "@/features/books/service";
import { saveBookAction, saveVolumeAction } from "@/features/books/actions";
import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/lib/errors";

const user = { id: 7, username: "fixture-user", role: "USER" as const, name: null, email: null, description: null };
function data(bookId = "11") {
  const form = new FormData();
  for (const [key, value] of Object.entries({ bookId, name: "수정 제목", author: "저자", description: "설명", type: "", totalVolume: "", coverUrl: "" })) form.set(key, value);
  return form;
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getCurrentUser).mockResolvedValue(user); });

it.each([
  ["book", saveBookAction], ["volume", saveVolumeAction]
] as const)("returns a login-required result before validation or persistence for an unauthenticated %s save", async (_name, save) => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(save(new FormData())).resolves.toEqual({ success: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." });
  expect(updateBook).not.toHaveBeenCalled(); expect(updateVolume).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("saves an authenticated user's book and refreshes its views", async () => {
  await expect(saveBookAction(data())).resolves.toEqual({ success: true, message: "책 정보를 저장했습니다." });
  expect(updateBook).toHaveBeenCalledWith(user.id, 11, {
    name: "수정 제목", author: "저자", description: "설명", type: "", totalVolume: "", coverUrl: ""
  }, null);
  expect(vi.mocked(revalidatePath).mock.calls.map(([route]) => route)).toEqual(["/books/11", "/books", "/dashboard", "/products"]);
});

it("preserves the ownership error without refreshing views", async () => {
  vi.mocked(updateBook).mockRejectedValue(new NotFoundError("책을 찾을 수 없습니다."));
  await expect(saveBookAction(data())).resolves.toEqual({ success: false, code: "NOT_FOUND", message: "책을 찾을 수 없습니다." });
  expect(updateBook).toHaveBeenCalledWith(user.id, 11, expect.any(Object), null);
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("rejects an invalid book id without writing data", async () => {
  await expect(saveBookAction(data("invalid"))).resolves.toMatchObject({ success: false, code: "VALIDATION_ERROR" });
  expect(updateBook).not.toHaveBeenCalled(); expect(revalidatePath).not.toHaveBeenCalled();
});
