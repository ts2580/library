import Link from "next/link";
export default function NotFoundPage() {
  return <main className="auth-page"><section className="auth-card stack-md"><p className="eyebrow">404</p><h1>페이지를 찾을 수 없습니다.</h1><p className="muted">주소가 바뀌었거나 접근할 수 없는 데이터입니다.</p><Link className="button" href="/dashboard">대시보드로 이동</Link></section></main>;
}
