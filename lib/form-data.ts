import "server-only";
import { AppError } from "@/lib/errors";

/** Bound the raw multipart body, including metadata, before the parser buffers it. */
export async function boundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const tooLarge = () => new AppError("업로드 요청이 허용 크기를 초과했습니다.", "PAYLOAD_TOO_LARGE", 413);
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) throw tooLarge();
  if (!request.body) throw new AppError("업로드 본문이 없습니다.");
  let received = 0;
  const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) throw tooLarge();
      controller.enqueue(chunk);
    }
  }));
  return new Response(limited, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}
