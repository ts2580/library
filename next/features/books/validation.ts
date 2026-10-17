import { z } from "zod";
import { isHttpUrl } from "@/lib/urls";
import { isWonInput, normalizeWonInput } from "@/lib/money";

export const entityIdSchema = z.coerce.number().int().positive("식별자가 올바르지 않습니다.");
export const volumeIdsSchema = z.array(entityIdSchema).min(1, "삭제할 권을 선택해 주세요.").max(1000);

const nullableText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const nullableHttpUrl = z.string().trim().max(2048).transform((value) => value || null)
  .refine(isHttpUrl, "http 또는 https URL만 사용할 수 있습니다.");

export const bookInputSchema = z.object({
  name: z.string().trim().min(1, "책 제목을 입력해 주세요.").max(300),
  author: nullableText(300),
  description: nullableText(5000),
  type: nullableText(120),
  totalVolume: nullableText(30),
  coverUrl: nullableHttpUrl
});

export const volumeInputSchema = z.object({
  type: nullableText(120).optional(),
  name: z.string().trim().min(1, "권 제목을 입력해 주세요.").max(500),
  seq: z.preprocess((value) => value === "" || value == null ? null : Number(value), z.number().int().min(0).max(100000).nullable()),
  isbn13: z.string().trim().max(32).transform((value) => value || null),
  author: nullableText(300),
  price: z.string().trim().max(30)
    .refine(isWonInput, "가격은 0 이상의 정수 또는 올바른 천 단위 쉼표 형식이어야 합니다.")
    .transform(normalizeWonInput),
  description: nullableText(5000),
  link: nullableHttpUrl,
  pubDate: nullableText(40),
  coverUrl: nullableHttpUrl,
  isPurchased: z.preprocess((value) => value === "on" || value === "true" || value === "1", z.boolean()),
  noNeedToBuy: z.preprocess((value) => value === "on" || value === "true" || value === "1", z.boolean())
}).refine((value) => !(value.isPurchased && value.noNeedToBuy), {
  message: "구매 완료와 구매 불필요를 동시에 선택할 수 없습니다."
});
