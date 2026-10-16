import { z } from "zod";

export const aladinSearchSchema = z.object({
  query: z.string().trim().min(1, "검색어를 입력해 주세요.").max(200),
  page: z.coerce.number().int().min(1).max(50).default(1)
});

export const isbn13Schema = z.string().trim().regex(/^\d{10,13}$/, "ISBN을 확인해 주세요.");
