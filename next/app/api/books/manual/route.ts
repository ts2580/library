import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/features/auth/authorization";
import { createManualBook } from "@/features/books/manual-create";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const form = await request.formData();
    let payload: unknown;
    try { payload = JSON.parse(String(form.get("payload") ?? "")); }
    catch { return Response.json({ message: "등록 정보를 확인해 주세요." }, { status: 400 }); }
    const file = form.get("coverFile");
    const result = await createManualBook(user.id, payload, file instanceof File && file.size ? file : null);
    for (const path of ["/books", "/dashboard", `/books/${result.bookId}`]) revalidatePath(path);
    return Response.json(result, { status: 201 });
  } catch (error) { return jsonError(error); }
}
