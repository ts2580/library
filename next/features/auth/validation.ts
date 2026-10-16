import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "아이디를 입력해 주세요.").max(120),
  password: z.string().min(1, "비밀번호를 입력해 주세요.").max(200),
  remember: z.preprocess((value) => value === "on" || value === "true", z.boolean())
});

export const signupSchema = z.object({
  username: z.string().trim().min(4, "아이디는 4자 이상이어야 합니다.").max(120)
    .regex(/^[A-Za-z0-9._-]+$/, "아이디에는 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다."),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다.").max(200),
  confirmPassword: z.string().max(200),
  email: z.string().trim().email("이메일 형식이 올바르지 않습니다.").max(320).or(z.literal("")),
  name: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(2000, "소개는 2,000자 이하여야 합니다.").optional().default("")
}).refine((value) => value.password === value.confirmPassword, {
  message: "비밀번호 확인값이 일치하지 않습니다.",
  path: ["confirmPassword"]
});
