import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

async function withInventory(page: Page, name: string, run: (db: Database.Database, owner: number) => Promise<void>) {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) {
    throw new Error("Expected isolated E2E data");
  }
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1")
    .run(name).lastInsertRowid);
  const book = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES('일괄 갱신 상태 검증',?)").run(owner).lastInsertRowid);
  db.prepare("INSERT INTO book_volumes(book,volume,name,isbn13) VALUES(?,1,'갱신 대상','9780000000193')").run(book);
  try {
    await page.goto("/login");
    await page.getByLabel("아이디", { exact: true }).fill(name);
    await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/inventory");
    await run(db, owner);
  } finally {
    await page.close();
    db.prepare("UPDATE stock_refresh_job SET status='IDLE',running=0,completed=0,failed=0,requested_by=NULL,lock_token=NULL,run_id=NULL WHERE requested_by=?").run(owner);
    db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM member WHERE id=?").run(owner);
    db.close();
  }
}

test("a stalled batch status request retries and clears QUEUED after the real worker completes", async ({ page }, testInfo) => {
  await withInventory(page, `batch-timeout-${testInfo.project.name}`, async (db, owner) => {
    let polls = 0;
    await page.route("**/api/stock-refresh", route => {
      // Leave the first GET unanswered, while allowing the real POST and worker to finish.
      if (route.request().method() === "GET" && ++polls === 1) return;
      return route.continue();
    });
    await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
    await expect(page.locator("#top-progress-bar")).toBeVisible();
    await expect.poll(() => (db.prepare("SELECT status FROM stock_refresh_job WHERE requested_by=?").get(owner) as { status: string })?.status)
      .toBe("COMPLETED");
    const panel = page.getByRole("region", { name: "중고 재고 일괄 갱신", exact: true });
    await expect(panel.locator(".status-badge")).toHaveText("COMPLETED", { timeout: 18_000 });
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await expect(panel.getByRole("button", { name: "갱신 시작", exact: true })).toBeEnabled();
    await expect(page.locator(".stock-card")).toHaveCount(2);
    await expect(page.locator(".kpi-status")).toHaveText("COMPLETED");
    expect(polls).toBe(2);
    await page.screenshot({ path: testInfo.outputPath("batch-completed-after-timeout.png"), fullPage: true });
  });
});

for (const status of [401, 403]) {
  test(`batch polling stops on HTTP ${status} and releases the progress bar`, async ({ page }, testInfo) => {
    await withInventory(page, `batch-auth-${status}-${testInfo.project.name}`, async () => {
      let polls = 0;
      await page.route("**/api/stock-refresh", route => {
        if (route.request().method() !== "GET") return route.continue();
        polls++;
        return route.fulfill({ status, json: { message: "로그인 또는 권한 확인 필요" } });
      });
      await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
      await expect(page.locator("#top-progress-bar")).toBeVisible();
      await expect(page.locator('.flash-error[role="alert"]')).toContainText("중단");
      await expect(page.locator("#top-progress-bar")).toBeHidden();
      await expect(page.getByRole("button", { name: "상태 확인 불가", exact: true })).toBeDisabled();
      await page.waitForTimeout(1800);
      expect(polls).toBe(1);
    });
  });
}

test("temporary batch polling errors recover without marking the worker job failed", async ({ page }, testInfo) => {
  await withInventory(page, `batch-retry-${testInfo.project.name}`, async () => {
    let polls = 0;
    await page.route("**/api/stock-refresh", route => {
      if (route.request().method() === "GET" && ++polls === 1) {
        return route.fulfill({ status: 503, json: { message: "일시적인 상태 조회 오류" } });
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
    await expect(page.locator('.flash-error[role="alert"]')).toContainText("일시적인 상태 조회 오류");
    await expect(page.locator("#top-progress-bar")).toBeVisible();
    await expect(page.locator(".status-badge")).toHaveText("QUEUED");
    await expect(page.locator(".status-badge")).toHaveText("COMPLETED");
    await expect(page.locator('.flash-error[role="alert"]')).toHaveCount(0);
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    expect(polls).toBe(2);
  });
});

test("returning to the inventory tab immediately checks the worker's completed status", async ({ page }, testInfo) => {
  await withInventory(page, `batch-focus-${testInfo.project.name}`, async () => {
    let queued: unknown;
    let polls = 0;
    await page.route("**/api/stock-refresh", async route => {
      if (route.request().method() === "POST") {
        const response = await route.fetch();
        queued = (await response.json()).progress;
        await route.fulfill({ response });
      } else if (++polls === 1) await route.fulfill({ json: queued });
      else await route.continue();
    });
    await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
    await expect.poll(() => polls).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".status-badge")).toHaveText("COMPLETED");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    expect(polls).toBe(2);
  });
});

test("fresh server props restart a stalled batch poll after inventory search navigation", async ({ page }, testInfo) => {
  await withInventory(page, `batch-props-${testInfo.project.name}`, async (db, owner) => {
    let polls = 0;
    await page.route("**/api/stock-refresh", route => {
      if (route.request().method() === "GET" && ++polls === 1) return;
      return route.continue();
    });
    await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
    await expect.poll(() => polls).toBe(1);
    expect((db.prepare("SELECT status FROM stock_refresh_job WHERE requested_by=?").get(owner) as { status: string }).status)
      .toBe("COMPLETED");
    await page.getByLabel("제목·ISBN·지점 검색").fill("갱신 대상");
    await page.getByRole("button", { name: "재고 검색", exact: true }).click();
    await expect(page.locator(".kpi-status")).toHaveText("COMPLETED");
    await expect(page.locator(".status-badge")).toHaveText("COMPLETED");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    expect(polls).toBe(2);
  });
});

test("cancelling a running batch persists cancellation and releases a stalled status request", async ({ page }, testInfo) => {
  await withInventory(page, `batch-cancel-${testInfo.project.name}`, async (db, owner) => {
    const runId = randomUUID();
    db.prepare(`UPDATE stock_refresh_job SET status='RUNNING',running=1,completed=0,failed=0,
      requested_by=?,run_id=?,lock_token='fixture-running',updated_at=CURRENT_TIMESTAMP,message='취소 검증 중'
      WHERE id=1`).run(owner, runId);
    const book = (db.prepare("SELECT id FROM books WHERE owner_id=?").get(owner) as { id: number }).id;
    db.prepare("INSERT INTO branchbook(book,volume,branch,branchname,price) VALUES(?,1,'CANCEL','취소 전 저장 재고','1200')").run(book);
    await page.reload();
    let polls = 0;
    await page.route("**/api/stock-refresh", route => {
      if (route.request().method() === "GET") { polls++; return; }
      return route.continue();
    });
    await expect.poll(() => polls).toBe(1);
    await expect(page.getByRole("button", { name: "갱신 취소", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("batch-cancel-button.png"), fullPage: true });
    await page.getByRole("button", { name: "갱신 취소", exact: true }).click();
    await expect(page.locator(".status-badge")).toHaveText("CANCELLED");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await expect(page.getByRole("button", { name: "갱신 시작", exact: true })).toBeEnabled();
    expect(db.prepare("SELECT status,lock_token FROM stock_refresh_job WHERE id=1").get()).toEqual({ status: "CANCELLED", lock_token: null });
    expect(db.prepare("SELECT COUNT(*) n FROM branchbook WHERE book=?").get(book)).toEqual({ n: 1 });
    await page.unroute("**/api/stock-refresh");
    await page.reload();
    await expect(page.locator(".status-badge")).toHaveText("CANCELLED");
    await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
    await expect(page.locator(".status-badge")).toHaveText("COMPLETED");
  });
});

test("the cancel API rejects another owner, a stale run, malformed input and a foreign origin", async ({ page }, testInfo) => {
  await withInventory(page, `batch-cancel-access-${testInfo.project.name}`, async (db, owner) => {
    const runId = randomUUID();
    db.prepare(`UPDATE stock_refresh_job SET status='RUNNING',running=1,completed=0,failed=0,
      requested_by=?,run_id=?,lock_token='fixture-running',updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(owner, runId);
    const stale = await page.request.patch("/api/stock-refresh", { data: { runId: randomUUID() } });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "STOCK_JOB_CHANGED" });
    const malformed = await page.request.patch("/api/stock-refresh", { data: "{", headers: { "content-type": "application/json" } });
    expect(malformed.status()).toBe(400);
    const foreignOrigin = await page.request.patch("/api/stock-refresh", { data: { runId }, headers: { origin: "https://other.example" } });
    expect(foreignOrigin.status()).toBe(403);
    db.prepare("UPDATE stock_refresh_job SET requested_by=3 WHERE id=1").run();
    try {
      const foreignOwner = await page.request.patch("/api/stock-refresh", { data: { runId } });
      expect(foreignOwner.status()).toBe(403);
      await page.reload();
      await expect(page.getByRole("button", { name: "갱신 취소", exact: true })).toHaveCount(0);
      expect(db.prepare("SELECT status FROM stock_refresh_job WHERE id=1").get()).toEqual({ status: "RUNNING" });
    } finally {
      db.prepare("UPDATE stock_refresh_job SET requested_by=? WHERE id=1").run(owner);
    }
  });
});

test("a failed cancellation opens a coded popup and can be retried", async ({ page }, testInfo) => {
  await withInventory(page, `batch-cancel-error-${testInfo.project.name}`, async (db, owner) => {
    db.prepare(`UPDATE stock_refresh_job SET status='RUNNING',running=1,completed=0,failed=0,
      requested_by=?,run_id=?,lock_token='fixture-running',updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(owner, randomUUID());
    await page.reload();
    let attempts = 0;
    await page.route("**/api/stock-refresh", route => {
      if (route.request().method() === "PATCH" && ++attempts === 1) {
        return route.fulfill({ status: 503, json: { code: "CANCEL_UNAVAILABLE", message: "취소 요청 오류 검증" } });
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "갱신 취소", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("CANCEL_UNAVAILABLE");
    await expect(dialog).toContainText("취소 요청 오류 검증");
    await dialog.getByRole("button", { name: "확인", exact: true }).click();
    await page.getByRole("button", { name: "갱신 취소", exact: true }).click();
    await expect(page.locator(".status-badge")).toHaveText("CANCELLED");
    await expect(dialog).toBeHidden();
  });
});

for (const status of ["FAILED", "COMPLETED"] as const) {
  test(`worker ${status} with failures opens a popup`, async ({ page }, testInfo) => {
    await withInventory(page, `batch-worker-error-${status}-${testInfo.project.name}`, async (db, owner) => {
      db.prepare(`UPDATE stock_refresh_job SET status=?,running=0,completed=?,failed=?,fail=1,
        requested_by=?,run_id=?,updated_at=CURRENT_TIMESTAMP,message='재고 조회 실패 검증' WHERE id=1`)
        .run(status, Number(status === "COMPLETED"), Number(status === "FAILED"), owner, randomUUID());
      await page.reload();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(status === "FAILED" ? "STOCK_REFRESH_FAILED" : "STOCK_REFRESH_PARTIAL_FAILURE");
      await expect(dialog).toContainText("재고 조회 실패 검증");
      await expect(page.locator("#top-progress-bar")).toBeHidden();
    });
  });
}

test("unchanged worker progress opens a delay popup and leaves cancellation available", async ({ page }, testInfo) => {
  await withInventory(page, `batch-stalled-${testInfo.project.name}`, async (db, owner) => {
    db.prepare(`UPDATE stock_refresh_job SET status='RUNNING',running=1,completed=0,failed=0,
      requested_by=?,run_id=?,lock_token='fixture-running',updated_at=datetime('now','-3 minutes') WHERE id=1`).run(owner, randomUUID());
    await page.reload();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("STOCK_REFRESH_STALLED");
    await expect(dialog).toContainText("2분 이상");
    await page.screenshot({ path: testInfo.outputPath("batch-stalled-popup.png"), fullPage: true });
    await dialog.getByRole("button", { name: "확인", exact: true }).click();
    await page.getByRole("button", { name: "갱신 취소", exact: true }).click();
    await expect(page.locator(".status-badge")).toHaveText("CANCELLED");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await expect(dialog).toBeHidden();
  });
});

test("a lost start response times out with a popup and reconciles the real worker result", async ({ page }, testInfo) => {
  test.setTimeout(35_000);
  await withInventory(page, `batch-start-timeout-${testInfo.project.name}`, async () => {
    let refreshes = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/inventory" && request.headers().rsc === "1") refreshes++;
    });
    await page.route("**/api/stock-refresh", async route => {
      if (route.request().method() === "POST") { await route.fetch(); return; }
      return route.continue();
    });
    await page.getByRole("button", { name: "갱신 시작", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 18_000 });
    await expect(dialog).toContainText("CLIENT_TIMEOUT");
    await expect(page.locator(".status-badge")).toHaveText("COMPLETED");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await dialog.getByRole("button", { name: "확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "갱신 시작", exact: true })).toBeEnabled();
    await expect(page.locator(".kpi-status")).toHaveText("COMPLETED");
    await expect(page.locator(".stock-card")).toHaveCount(2);
    await expect(page.locator(".branch-card")).toHaveCount(2);
    await expect(page.locator(".kpi-value").nth(1)).toHaveText("2");
    await expect(page.locator(".kpi-value").nth(2)).toHaveText("4,000원");
    await expect(page.getByTestId("branch-inventory-bar")).toHaveCount(2);
    expect(refreshes).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("lost-start-inventory-reconciled.png"), fullPage: true });
  });
});

test("a lost delete response reconciles server-rendered inventory, totals and branches", async ({ page }, testInfo) => {
  test.setTimeout(35_000);
  await withInventory(page, `batch-delete-timeout-${testInfo.project.name}`, async (db, owner) => {
    const book = (db.prepare("SELECT id FROM books WHERE owner_id=?").get(owner) as { id: number }).id;
    db.prepare("INSERT INTO branchbook(book,volume,branch,branchname,price) VALUES(?,1,'DELETE','삭제 대상 지점','1200')").run(book);
    await page.reload();
    await expect(page.locator(".stock-card")).toHaveCount(1);
    await expect(page.locator(".branch-card")).toHaveCount(1);
    let refreshes = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/inventory" && request.headers().rsc === "1") refreshes++;
    });
    await page.route("**/api/stock-refresh", async route => {
      if (route.request().method() === "DELETE") { await route.fetch(); return; }
      return route.continue();
    });
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "전체 삭제", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 18_000 });
    await expect(dialog).toContainText("CLIENT_TIMEOUT");
    await expect(page.locator(".status-badge")).toHaveText("IDLE");
    await expect(page.locator("#top-progress-bar")).toBeHidden();
    await dialog.getByRole("button", { name: "확인", exact: true }).click();
    await expect(page.locator(".stock-card")).toHaveCount(0);
    await expect(page.locator(".branch-card")).toHaveCount(0);
    await expect(page.locator(".kpi-value").nth(1)).toHaveText("0");
    await expect(page.locator(".kpi-value").nth(2)).toHaveText("0원");
    await expect(page.getByTestId("branch-inventory-bar")).toHaveCount(0);
    expect(refreshes).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("lost-delete-inventory-reconciled.png"), fullPage: true });
  });
});
