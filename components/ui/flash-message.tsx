import { Suspense } from "react";
import { ErrorReporter } from "@/components/ui/error-dialog";
import { RedirectToast } from "@/components/ui/redirect-toast";

export function FlashMessage({ message, error }: { message?: string | null; error?: string | null }) {
  return <>
    {error ? <div role="alert" className="flash flash-error">{error}</div>
      : message && <Suspense fallback={null}><RedirectToast message={message}/></Suspense>}
    <ErrorReporter message={error}/>
  </>;
}
