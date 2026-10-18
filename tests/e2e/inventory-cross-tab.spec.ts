import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { tmpdir } from "node:os";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

for (const discovery of ["background", "focus"] as const) {
  test(`an IDLE book tab discovers another tab's real job through ${discovery}`, async ({ page }, testInfo) => {
    const directory = process.env.BOOKSHELF_E2E_DATA;
    if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
    const db = new Database(path.join(directory, "bookshelf.sqlite"));
    const username = `cross-tab-${discovery}-${testInfo.project.name}`;
    const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1").run(username).lastInsertRowid);
    const book = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES('다른 탭 재고 검증',?)").run(owner).lastInsertRowid);
    db.prepare("INSERT INTO book_volumes(book,volume,name,isbn13) VALUES(?,1,'다른 탭 대상 권','9780000000191')").run(book);
    let other: Page | undefined;
    try {
      await login(page, username); await page.goto(`/books/${book}`);
      const meta = page.locator(".volume-card .volume-meta");
      await expect(meta).toContainText("재고 0건");
      await expect(page.getByRole("button", { name: "재고 검색", exact: true })).toBeEnabled();
      other = await page.context().newPage(); await other.goto("/inventory");
      const queued = other.waitForResponse(response => response.url().endsWith("/api/stock-refresh") && response.request().method() === "POST");
      await other.getByRole("button", { name: "갱신 시작", exact: true }).click();
      expect((await queued).status()).toBe(202);
      const run = db.prepare("SELECT run_id FROM stock_refresh_job WHERE requested_by=?").get(owner) as {run_id:string};
      expect(run.run_id).toBeTruthy();
      await expect.poll(() => (db.prepare("SELECT status FROM stock_refresh_job WHERE requested_by=?").get(owner) as {status:string})?.status).toBe("COMPLETED");
      if (discovery === "focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(meta).toContainText("재고 2건", {timeout:20_000});
      await expect(meta).toContainText("최저 1,700원");
      const after = db.prepare("SELECT run_id FROM stock_refresh_job WHERE requested_by=?").get(owner) as {run_id:string};
      expect(after.run_id).toBe(run.run_id);
    } finally {
      await other?.close();
      db.prepare("UPDATE stock_refresh_job SET status='IDLE',running=0,completed=0,failed=0,requested_by=NULL,lock_token=NULL,run_id=NULL WHERE requested_by=?").run(owner);
      db.prepare("DELETE FROM books WHERE owner_id=?").run(owner);
      db.prepare("DELETE FROM member WHERE id=?").run(owner); db.close();
    }
  });
}

test("a timed-out stock request releases its request slot and retries", async ({ page }) => {
  await login(page, "fixture-admin"); await page.goto("/books/1");
  let polls = 0;
  await page.route("**/api/books/1/stock-search", async route => {
    if (route.request().method() === "POST") {
      await route.fulfill({status:202,json:{progress:{status:"RUNNING",mode:"APPEND_BOOK",scopeBookId:1,message:"진행 중"}}});
    } else if (++polls === 1) {
      // Remain pending until the browser's fetch timeout cancels the request.
      await new Promise<void>(resolve => page.once("close", () => resolve()));
    } else await route.fulfill({json:{status:"COMPLETED",mode:"APPEND_BOOK",scopeBookId:1,message:"시간 초과 후 완료"}});
  });
  await page.getByRole("button", {name:"재고 검색",exact:true}).click();
  await expect(page.locator('.flash-error[role="alert"]')).toContainText("시간이 초과",{timeout:15_000});
  await expect(page.getByRole("status").filter({hasText:"시간 초과 후 완료"})).toBeVisible();
  expect(polls).toBe(2);
});

test("new server props wake up an IDLE hook without retaining its previous state", async ({ page }, testInfo) => {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db = new Database(path.join(directory,"bookshelf.sqlite"));
  try {
    db.prepare("UPDATE stock_refresh_job SET status='IDLE',running=0,requested_by=NULL,run_id=NULL WHERE id=1").run();
    await login(page,"fixture-book-stock"); await page.goto("/books/4");
    const button=page.getByRole("button",{name:"재고 검색",exact:true});
    await expect(button).toBeEnabled();
    db.prepare("UPDATE stock_refresh_job SET status='RUNNING',running=1,requested_by=4,mode='REPLACE_ALL',scope_book_id=NULL,run_id=?,lock_token=NULL WHERE id=1").run(`server-prop-${testInfo.project.name}`);
    await page.getByRole("form",{name:"책 정보",exact:true}).getByRole("button",{name:"저장",exact:true}).click();
    await expect(button).toBeDisabled();
    db.prepare("UPDATE stock_refresh_job SET status='COMPLETED',running=0,completed=1 WHERE id=1").run();
    await expect(button).toBeEnabled();
    await expect(page.locator("#top-progress-bar")).toBeHidden();
  } finally {
    db.prepare("UPDATE stock_refresh_job SET status='IDLE',running=0,completed=0,failed=0,requested_by=NULL,run_id=NULL,lock_token=NULL WHERE id=1").run();
    db.close();
  }
});

test("an owner's unseen completion survives another owner's completed job", async ({ page, browser }, testInfo) => {
  const directory=process.env.BOOKSHELF_E2E_DATA;
  if(!directory || path.dirname(directory)!==tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) throw new Error("Expected isolated E2E data");
  const db=new Database(path.join(directory,"bookshelf.sqlite"));
  const owners=["a","b"].map(suffix=>{
    const username=`completion-${suffix}-${testInfo.project.name}`;
    const id=Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1").run(username).lastInsertRowid);
    const book=Number(db.prepare("INSERT INTO books(name,owner_id) VALUES('완료 보존 검증',?)").run(id).lastInsertRowid);
    db.prepare("INSERT INTO book_volumes(book,volume,name,isbn13) VALUES(?,1,'작업 권','9780000000192')").run(book);
    return {id,book,username};
  });
  const other=await browser.newContext();
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  try {
    await login(page,owners[0].username); await page.goto(`/books/${owners[0].book}`);
    const metadata=page.locator(".volume-card .volume-meta");
    await expect(metadata).toContainText("재고 0건");
    await page.route(`**/api/books/${owners[0].book}/stock-search`,async route=>{await blocked; await route.continue();});
    expect((await page.request.post("/api/stock-refresh")).status()).toBe(202);
    await expect.poll(()=>(db.prepare("SELECT status FROM stock_refresh_job WHERE requested_by=?").get(owners[0].id) as {status:string})?.status).toBe("COMPLETED");
    const a=db.prepare("SELECT run_id FROM stock_refresh_completion WHERE owner_id=?").get(owners[0].id) as {run_id:string};
    const bPage=await other.newPage(); await login(bPage,owners[1].username);
    expect((await bPage.request.post("/api/stock-refresh")).status()).toBe(202);
    await expect.poll(()=>(db.prepare("SELECT status FROM stock_refresh_job WHERE requested_by=?").get(owners[1].id) as {status:string})?.status).toBe("COMPLETED");
    await expect(metadata).toContainText("재고 0건");
    const response=page.waitForResponse(r=>r.url().endsWith(`/api/books/${owners[0].book}/stock-search`));
    release(); await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    const progress=await (await response).json();
    expect(progress).toMatchObject({status:"IDLE",completionId:a.run_id,total:0});
    expect(progress.runId).toBeUndefined();
    await expect(metadata).toContainText("재고 2건");
    await expect(metadata).toContainText("최저 1,700원");
  } finally {
    release(); await page.unrouteAll({behavior:"wait"}); await other.close();
    for(const owner of owners) {
      db.prepare("UPDATE stock_refresh_job SET status='IDLE',running=0,requested_by=NULL,run_id=NULL,lock_token=NULL WHERE requested_by=?").run(owner.id);
      db.prepare("DELETE FROM books WHERE owner_id=?").run(owner.id); db.prepare("DELETE FROM member WHERE id=?").run(owner.id);
    }
    db.close();
  }
});
