import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

function inventoryFixture() {
  const directory = process.env.BOOKSHELF_E2E_DATA;
  if (!directory || path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith("bookshelf-e2e-")) {
    throw new Error("Expected isolated E2E data");
  }
  const db = new Database(path.join(directory, "bookshelf.sqlite"));
  const username = `chart-${randomUUID()}`;
  const owner = Number(db.prepare("INSERT INTO member(username,password_hash,role) SELECT ?,password_hash,'ADMIN' FROM member WHERE id=1")
    .run(username).lastInsertRowid);
  const book = Number(db.prepare("INSERT INTO books(name,owner_id) VALUES('그래프 검증 재고',?)").run(owner).lastInsertRowid);
  return {
    username,
    add(branch: string, name: string, price: string) {
      db.prepare("INSERT INTO branchbook(book,branch,branchname,name,price) VALUES(?,?,?,'그래프 검증 재고',?)")
        .run(book, branch, name, price);
    },
    close() {
      db.prepare("DELETE FROM branchbook WHERE book=?").run(book);
      db.prepare("DELETE FROM books WHERE id=?").run(book);
      db.prepare("DELETE FROM member WHERE id=?").run(owner);
      db.close();
    }
  };
}

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/inventory");
}

test("branch amount chart compares the owner's full inventory and links to branch details", async ({ page }, testInfo) => {
  const own = inventoryFixture();
  const other = inventoryFixture();
  const longName = "부산센텀시티아주긴이름의중고서점";
  try {
    for (let index = 0; index < 25; index++) own.add("SEOUL", "서울점", "60,000");
    own.add("BUSAN 점", longName, "750,000");
    own.add("INCHEON", "인천점", "450,000");
    own.add("ZERO", "영원점", "0");
    own.add("UNKNOWN_PRICE", "가격 미확인점", "가격 문의");
    other.add("SEOUL", "다른 계정 지점", "9,000,000");
    await login(page, own.username);
    const chart = page.getByRole("region", { name: "지점별 재고 금액 비교", exact: true });
    await expect(chart).toBeVisible();
    const links = chart.getByRole("link");
    await expect(links).toHaveText([
      "서울점1,500,000원", `${longName}750,000원`, "인천점450,000원", "가격 미확인점가격 미확인", "영원점0원"
    ]);
    await expect(chart).not.toContainText("다른 계정 지점");
    const widths = testInfo.project.name === "desktop" ? [1440, 768] : [412, 320];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      const bars = await chart.getByTestId("branch-inventory-bar").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
      expect(bars[0]).toBeGreaterThan(0);
      expect(bars[1] / bars[0]).toBeCloseTo(0.5, 2);
      expect(bars[2] / bars[0]).toBeCloseTo(0.3, 2);
      expect(bars.slice(3)).toEqual([0, 0]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await chart.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await chart.evaluate(element => element.scrollIntoView({ block: "start" }));
      await chart.screenshot({ path: testInfo.outputPath(`inventory-chart-${width}.png`) });
    }
    await page.goto("/inventory?page=2");
    await expect(page.locator(".stock-card")).toHaveCount(5);
    await expect(links.first()).toContainText("1,500,000원");
    await page.goto("/inventory?q=not-found");
    await expect(page.locator(".stock-card")).toHaveCount(0);
    await expect(links).toHaveCount(5);
    await expect(links.first()).toContainText("1,500,000원");
    await links.nth(1).click();
    await expect(page.getByRole("heading", { level: 1, name: longName, exact: true })).toBeVisible();
    await expect(page.locator(".stock-card")).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: longName, exact: true })).toBeVisible();
    await page.goto("/inventory");
    await links.first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory\/branches\/SEOUL$/);
    await expect(page.getByRole("heading", { level: 1, name: "서울점", exact: true })).toBeVisible();
  } finally { own.close(); other.close(); }
});

test("branch amount chart handles empty, unpriced and zero-price inventory", async ({ page }, testInfo) => {
  const fixture = inventoryFixture();
  try {
    await login(page, fixture.username);
    const chart = page.getByRole("region", { name: "지점별 재고 금액 비교", exact: true });
    await expect(chart.getByText("비교할 지점 재고가 없습니다.", { exact: true })).toBeVisible();
    await expect(chart.getByRole("link")).toHaveCount(0);
    fixture.add("ZERO", "영원점", "0");
    fixture.add("UNKNOWN_PRICE", "가격 미확인점", "가격 문의");
    await page.reload();
    await expect(chart.getByRole("link", { name: "영원점 0원", exact: true })).toBeVisible();
    await expect(chart.getByRole("link", { name: "가격 미확인점 가격 미확인", exact: true })).toBeVisible();
    const bars = chart.getByTestId("branch-inventory-bar");
    await expect(bars).toHaveCount(2);
    expect(await bars.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))).toEqual([0, 0]);
    await chart.screenshot({ path: testInfo.outputPath("inventory-chart-zero.png") });
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "전체 삭제", exact: true }).click();
    await expect(chart.getByText("비교할 지점 재고가 없습니다.", { exact: true })).toBeVisible();
  } finally { fixture.close(); }
});

test("branch detail preserves literal percent sequences and distinct encoded-looking identifiers", async ({ page }) => {
  const fixture = inventoryFixture();
  const branches = ["50% OFF", "A%20B", "A B", "한글 % 지점", "A%2520B"];
  try {
    for (const [index, branch] of branches.entries()) fixture.add(branch, `특수 지점 ${index}`, String(1000 + index));
    await login(page, fixture.username);
    for (const [index, branch] of branches.entries()) {
      await page.goto("/inventory");
      const chart = page.getByRole("region", { name: "지점별 재고 금액 비교", exact: true });
      const link = chart.getByRole("link").filter({ hasText: `특수 지점 ${index}` });
      await expect(link).toHaveAttribute("href", `/inventory/branches/${encodeURIComponent(branch)}`);
      await link.click();
      await expect(page.getByRole("heading", { level: 1, name: `특수 지점 ${index}`, exact: true })).toBeVisible();
      await expect(page.locator(".stock-card")).toHaveCount(1);
      await expect(page.locator(".stock-card")).toContainText(`${(1000 + index).toLocaleString("ko-KR")}원`);
      const response = await page.reload();
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: `특수 지점 ${index}`, exact: true })).toBeVisible();
    }
  } finally { fixture.close(); }
});
