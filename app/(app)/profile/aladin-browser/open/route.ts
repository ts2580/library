import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/features/auth/authorization";
import { canConnectBrowser, getStockBrowserStatus } from "@/features/aladin/browser-session";
import { env } from "@/lib/env";

export async function GET() {
  const user = await requireUser();
  if (!canConnectBrowser(user.username)) notFound();
  const status = await getStockBrowserStatus(user.id);
  if (status !== "connected") {
    const error = status === "disconnected"
      ? "브라우저 창이 닫혔습니다. 전용 브라우저를 다시 연결해 주세요."
      : "전용 브라우저 상태를 확인할 수 없습니다. 서버 연결을 확인해 주세요.";
    redirect(`/profile?error=${encodeURIComponent(error)}`);
  }
  const viewer = new URL(env.ALADIN_BROWSER_PUBLIC_URL || `http://127.0.0.1:${env.ALADIN_BROWSER_VNC_PORT}/vnc.html`);
  if (!viewer.searchParams.has("resize") && !new URLSearchParams(viewer.hash.slice(1)).has("resize")) {
    viewer.searchParams.set("resize", "scale");
  }
  redirect(viewer.href);
}
