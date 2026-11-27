"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";
import type { StockRefreshProgress } from "@/features/inventory/types";

export function StockErrorNotice({ progress }: { progress: StockRefreshProgress }) {
  const { status, fail, message, runId } = progress;
  useEffect(() => {
    if (!runId || !(status === "FAILED" || (status === "COMPLETED" && fail > 0))) return;
    // Claim once on the server, including when two tabs see the same completion.
    void fetch("/api/stock-refresh", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "notify", runId })
    }).then(async response => {
      if (response.ok && (await response.json()).show) {
        reportClientError({ message, code: status === "FAILED" ? "STOCK_REFRESH_FAILED" : "STOCK_REFRESH_PARTIAL_FAILURE",
          source: "stock-worker", eventId: runId });
      }
    }).catch(() => { /* The failure remains available in the run history. */ });
  }, [status, fail, message, runId]);
  return null;
}
