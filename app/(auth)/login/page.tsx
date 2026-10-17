import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { FlashMessage } from "@/components/ui/flash-message";

export const metadata = { title: "로그인" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const query = await searchParams;
  return <main className="auth-page"><section className="auth-card stack-lg"><div className="auth-brand"><span className="brand-mark">B</span><span>Bookshelf</span></div><div><p className="eyebrow">Welcome back</p><h1>로그인</h1><p className="page-subtitle">책장과 재고를 이어서 관리합니다.</p></div><FlashMessage error={query.error}/><form action={loginAction} className="stack-md"><div className="field"><label htmlFor="username">아이디</label><input className="input" id="username" name="username" autoComplete="username" required autoFocus/></div><div className="field"><label htmlFor="password">비밀번호</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required/></div><label className="check"><input type="checkbox" name="remember"/> 로그인 상태 유지</label><button className="button" type="submit">로그인</button></form><p className="auth-footer">계정이 없습니까? <Link href="/signup">회원가입</Link></p></section></main>;
}
