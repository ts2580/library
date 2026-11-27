import { canConnectBrowser, hasStockBrowser } from "@/features/aladin/browser-session";
import { changeAladinBrowserAction } from "@/features/profile/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export function AladinBrowserPanel({ ownerId, username }: { ownerId: number; username: string }) {
  if (!canConnectBrowser(username)) return null;
  const connected = hasStockBrowser(ownerId);
  return <section className="panel stack-md">
    <h2>재고 조회용 알라딘 로그인</h2>
    <p>{connected ? "전용 브라우저 연결됨" : "전용 브라우저 연결 해제됨"}</p>
    {connected && <>
      <p className="muted">서버에 SSH 터널을 연결한 뒤 브라우저에서 알라딘 로그인과 인증을 마쳐 주세요. 로그인한 알라딘 탭을 열어 두면 재고 조회에 사용됩니다.</p>
      <a className="text-link" href="http://127.0.0.1:7900/" target="_blank" rel="noreferrer">서버 브라우저 열기</a>
    </>}
    <form action={changeAladinBrowserAction}>
      <input type="hidden" name="operation" value={connected ? "disconnect" : "connect"}/>
      <SubmitButton pendingLabel="처리 중">{connected ? "연결 해제" : "전용 브라우저 연결"}</SubmitButton>
    </form>
  </section>;
}
