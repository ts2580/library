"use client";

import { useEffect } from "react";
import { ErrorReporter } from "@/components/ui/error-dialog";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Bookshelf route error", { digest: error.digest, error });
  }, [error]);

  return <main className="auth-page"><ErrorReporter code="ROUTE_ERROR" source="route" message={`화면을 표시하지 못했습니다. 다시 시도해 주세요.${error.digest ? ` 오류 식별자: ${error.digest}` : ""}`}/><section className="auth-card stack-md"><p className="eyebrow">Unexpected error</p><h1>화면을 표시하지 못했습니다.</h1><p className="muted">요청을 처리하는 중 오류가 발생했습니다. 다시 시도해 주세요.</p>{error.digest && <p className="muted small">오류 식별자: {error.digest}</p>}<button className="button" onClick={reset}>다시 시도</button></section></main>;
}
