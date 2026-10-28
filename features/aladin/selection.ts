import { z } from "zod";
import { aladinSearchOptionsSchema } from "@/features/aladin/validation";

export const bulkSelectionSchema = z.object({
  query: z.string().trim().min(1).max(200),
  targetBookId: z.number().int().positive().nullable(),
  seriesName: z.string().trim().min(1).max(300),
  sideStory: z.boolean(),
  preserveSelectionOrder: z.boolean().default(false),
  startVolume: z.number().int().min(1).max(100000).optional(),
  category: z.string().trim().max(120).optional(),
  totalVolume: z.string().trim().max(30).optional(),
  searchOptions: aladinSearchOptionsSchema.optional(),
  selection: z.array(z.object({ page: z.number().int().min(1).max(50), key: z.string().trim().min(1).max(32), sideStory: z.boolean().optional() }))
    .min(1, "등록할 항목을 선택해 주세요.").max(1000)
}).refine((input) => new Set(input.selection.map((item) => item.page)).size <= 10, {
  message: "한 번에 최대 10개 페이지에서 선택할 수 있습니다."
});

export type BulkSelection = z.infer<typeof bulkSelectionSchema>;
