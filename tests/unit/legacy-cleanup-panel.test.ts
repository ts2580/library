import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegacyCleanupPanel } from "@/components/profile/legacy-cleanup-panel";
import type { CleanupStatus } from "@/features/migration/types";

it.each([
  ["CLEANED", false, "기존 DB와 표지가 없습니다. 새 책장 데이터는 유지됩니다."],
  ["BLOCKED", false, "기존 Spring을 종료한 뒤 다시 시도하세요."],
  ["READY", true, "이전본·백업·표지를 다시 검증한 뒤 삭제합니다."]
] as const)("renders the server-provided %s state before browser JavaScript runs", (state, canDelete, message) => {
  const initialStatus: CleanupStatus = { state, canDelete, message, databaseBytes: 0, coverBytes: 0, coverFiles: 0 };
  const html = renderToStaticMarkup(createElement(LegacyCleanupPanel, { initialStatus }));
  expect(html).toContain(message);
  expect(html).not.toContain("원본 데이터 상태를 확인하고 있습니다.");
  if (state === "CLEANED") expect(html).toContain("원본 삭제 완료");
});
