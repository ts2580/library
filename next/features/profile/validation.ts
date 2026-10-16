import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().max(120, "이름은 120자 이하여야 합니다."),
  email: z.string().trim().email("이메일 형식이 올바르지 않습니다.").max(320).or(z.literal("")),
  description: z.string().trim().max(2000, "소개는 2,000자 이하여야 합니다.")
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "현재 비밀번호를 입력해 주세요."),
  newPassword: z.string().min(8, "새 비밀번호는 8자 이상이어야 합니다.").max(200),
  confirmPassword: z.string().max(200)
}).refine((value) => value.newPassword === value.confirmPassword, {
  message: "새 비밀번호 확인값이 일치하지 않습니다.",
  path: ["confirmPassword"]
});
