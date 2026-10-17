import { redirect } from "next/navigation";
import { getCurrentUser } from "@/features/auth/session";

export default async function HomePage() {
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
