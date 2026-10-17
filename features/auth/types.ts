export type UserRole = "USER" | "ADMIN";

export interface SessionUser {
  id: number;
  username: string;
  email: string | null;
  name: string | null;
  description: string | null;
  role: UserRole;
}
