import { canConnectBrowser, getStockBrowserStatus } from "@/features/aladin/browser-session";
import { changeAladinBrowserAction } from "@/features/profile/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { env } from "@/lib/env";

export async function AladinBrowserPanel({ ownerId, username }: { ownerId: number; username: string }) {
  if (!canConnectBrowser(username)) return null;
  const status = await getStockBrowserStatus(ownerId);
  const connected = status === "connected";
  const publicUrl = env.ALADIN_BROWSER_PUBLIC_URL;
  return <section className="panel stack-md">
    <h2>재고 조회용 알라딘 로그인</h2>
    <p>{{ connected: "전용 브라우저 연결됨", disconnected: "전용 브라우저 연결 해제됨", unavailable: "전용 브라우저 상태를 확인할 수 없습니다." }[status]}</p>
    {connected && <>
      <p className="muted">{!publicUrl && "서버에 SSH 터널을 연결해 주세요. "}서버 브라우저에서 알라딘 로그인과 인증을 마친 뒤 알라딘 탭을 열어 두세요.</p>
      <a className="text-link" href="/profile/aladin-browser/open" target="_blank" rel="noreferrer">서버 브라우저 열기</a>
    </>}
    <form action={changeAladinBrowserAction}>
      <input type="hidden" name="operation" value={connected ? "disconnect" : "connect"}/>
      <SubmitButton pendingLabel="처리 중">{connected ? "연결 해제" : "전용 브라우저 연결"}</SubmitButton>
    </form>
  </section>;
}
