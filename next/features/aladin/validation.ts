import { z } from "zod";

export const aladinSearchOptionsSchema = z.object({
  queryType: z.enum(["Title", "Keyword", "Author", "Publisher"]).default("Title"),
  searchTarget: z.enum(["Book", "Foreign", "Music", "DVD", "Used", "eBook", "All"]).default("Book"),
  sort: z.enum(["PublishTime", "Accuracy", "Title", "SalesPoint", "CustomerRating", "MyReviewCount"]).default("PublishTime"),
  cover: z.enum(["Big", "MidBig", "Mid", "Small", "Mini", "None"]).default("Big"),
  maxResults: z.coerce.number().int().min(1).max(100).default(20),
  categoryId: z.preprocess((value) => value === "" || value == null ? undefined : value, z.coerce.number().int().positive().optional()),
  recentPublishFilter: z.coerce.number().int().min(0).max(60).default(0),
  outOfStockFilter: z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean()).default(false)
});
export type AladinSearchOptions = z.infer<typeof aladinSearchOptionsSchema>;

export const aladinSearchSchema = aladinSearchOptionsSchema.extend({
  query: z.string().trim().min(1, "검색어를 입력해 주세요.").max(200),
  page: z.coerce.number().int().min(1).max(50).default(1)
});

export const isbn13Schema = z.string().trim().toUpperCase().regex(/^(?:\d{13}|\d{9}[\dX])$/, "ISBN10 또는 ISBN13을 확인해 주세요.");
export const usedSourceSchema = z.enum(["all", "dropshipping", "offstore"]).default("all");
