import Link from "next/link";
import { redirect } from "next/navigation";
import { signupAction } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { FlashMessage } from "@/components/ui/flash-message";
import { env } from "@/lib/env";

export const metadata = { title: "회원가입" };
export const dynamic = "force-dynamic";
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!env.REGISTRATION) redirect("/login?error=" + encodeURIComponent("현재 회원가입이 비활성화되어 있습니다."));
  if (await getCurrentUser()) redirect("/dashboard");
  const query = await searchParams;
  return <main className="auth-page"><section className="auth-card stack-lg"><div className="auth-brand"><span className="brand-mark">B</span><span>Bookshelf</span></div><div><p className="eyebrow">Create account</p><h1>회원가입</h1><p className="page-subtitle">첫 번째 계정은 관리자 권한을 받습니다.</p></div><FlashMessage error={query.error}/><form action={signupAction} className="stack-md"><div className="field"><label htmlFor="username">아이디</label><input className="input" id="username" name="username" minLength={4} maxLength={120} required/></div><div className="field"><label htmlFor="name">이름</label><input className="input" id="name" name="name" maxLength={120}/></div><div className="field"><label htmlFor="email">이메일</label><input className="input" id="email" name="email" type="email" maxLength={320}/></div><div className="field"><label htmlFor="password">비밀번호</label><input className="input" id="password" name="password" type="password" minLength={8} required/></div><div className="field"><label htmlFor="confirmPassword">비밀번호 확인</label><input className="input" id="confirmPassword" name="confirmPassword" type="password" minLength={8} required/></div><div className="field"><label htmlFor="description">소개</label><textarea className="textarea" id="description" name="description" maxLength={2000}/></div><button className="button" type="submit">계정 만들기</button></form><p className="auth-footer">이미 계정이 있습니까? <Link href="/login">로그인</Link></p></section></main>;
}
