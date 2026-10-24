import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { tmpdir } from "node:os";

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
