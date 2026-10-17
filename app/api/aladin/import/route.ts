import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/features/auth/authorization";
import { importAladinSelection } from "@/features/aladin/bulk-import";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    if (Number(request.headers.get("content-length")) > 128 * 1024) throw new AppError("선택 요청이 너무 큽니다.");
    const body = await request.text();
    if (Buffer.byteLength(body) > 128 * 1024) throw new AppError("선택 요청이 너무 큽니다.");
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new AppError("올바른 JSON 요청이 아닙니다."); }
    const result = await importAladinSelection(user.id, input);
    revalidatePath("/books"); revalidatePath(`/books/${result.bookId}`); revalidatePath("/dashboard");
    return Response.json(result, { status: 201 });
  } catch (error) { return jsonError(error); }
}
