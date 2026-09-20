// Run against an isolated server with a test account. No credentials are saved in artifacts.
// BOOKSHELF_BASE_URL, BOOKSHELF_SMOKE_USERNAME and BOOKSHELF_SMOKE_PASSWORD are required.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseURL = process.env.BOOKSHELF_BASE_URL;
const username = process.env.BOOKSHELF_SMOKE_USERNAME;
const password = process.env.BOOKSHELF_SMOKE_PASSWORD;
assert(baseURL && username && password, 'Set the base URL and dedicated test account environment variables.');

(async () => {
  const browser = await chromium.launch({ headless: true });
  let passed = 0;
  try {
    const cases = [
      { name: 'normal', statuses: [200] },
      { name: 'expired-session-desktop', stale: true, statuses: [403, 200], refreshes: 1 },
      { name: 'expired-session-tablet', stale: true, width: 768, statuses: [403, 200], refreshes: 1 },
      { name: 'expired-session-mobile', stale: true, width: 390, statuses: [403, 200], refreshes: 1 },
      { name: 'missing-token', missingToken: true, statuses: [403, 200], refreshes: 1 },
      { name: 'wrong-password', wrong: true, statuses: [401], error: true },
      { name: 'expired-session-wrong-password', stale: true, wrong: true, statuses: [403, 401], refreshes: 1, error: true },
      { name: 'retry-limit', reject: 'csrf', statuses: [403, 403], refreshes: 1, error: true },
      { name: 'other-forbidden-no-retry', reject: 'forbidden', statuses: [403], error: true },
      { name: 'refresh-failure', stale: true, refreshFailure: true, statuses: [403], refreshes: 1, error: true },
      { name: 'network-failure-no-retry', networkFailure: true, statuses: [], error: true },
      { name: 'duplicate-submit', duplicate: true, stale: true, statuses: [403, 200], refreshes: 1 },
      { name: 'remember-me-after-recovery', remember: true, stale: true, statuses: [403, 200], refreshes: 1 },
      { name: 'javascript-disabled', noJs: true, statuses: [302] },
    ];
    for (const test of cases) {
      const context = await browser.newContext({
        baseURL, javaScriptEnabled: !test.noJs,
        viewport: { width: test.width || 1440, height: 900 },
      });
      try {
        const page = await context.newPage();
        const statuses = [];
        const pageErrors = [];
        const consoleErrors = [];
        const navigations = [];
        let posts = 0;
        let refreshes = 0;
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => {
          if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
            consoleErrors.push(message.text());
          }
        });
        page.on('framenavigated', frame => {
          if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
        });
        page.on('request', request => {
          const path = new URL(request.url()).pathname;
          if (path === '/user/login' && request.method() === 'POST') posts++;
          if (path === '/user/login/csrf') refreshes++;
        });
        page.on('response', response => {
          if (new URL(response.url()).pathname === '/user/login' && response.request().method() === 'POST') {
            statuses.push(response.status());
          }
        });
        if (test.reject || test.networkFailure) {
          await page.route('**/user/login', route => {
            if (route.request().method() !== 'POST') return route.continue();
            if (test.networkFailure) return route.abort('failed');
            return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: test.reject }) });
          });
        }
        if (test.refreshFailure) {
          await page.route('**/user/login/csrf', route => route.fulfill({ status: 503, body: 'Unavailable' }));
        }

        await page.goto('/user/login');
        await page.locator('#username').fill(username);
        const submittedPassword = test.wrong ? `${password}-wrong` : password;
        await page.locator('#password').fill(submittedPassword);
        if (test.remember) await page.locator('[name="remember-me"]').check();
        if (test.stale) await context.clearCookies();
        if (test.missingToken) {
          await page.locator('input[name="_csrf"]').evaluateAll(inputs => inputs.forEach(input => { input.value = ''; }));
        }
        if (test.duplicate) {
          await page.locator('#login-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
        } else {
          await page.locator('button[type="submit"]').click();
        }

        if (test.error) {
          await page.locator('#login-feedback').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#username').inputValue(), username);
          assert.equal(await page.locator('#password').inputValue(), submittedPassword);
          assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
          assert.deepEqual(navigations, ['/user/login']);
          if (test.wrong) assert.match(await page.locator('#login-feedback').innerText(), /아이디 또는 비밀번호/);
        } else {
          await page.waitForURL('**/dashboard');
          await page.waitForLoadState('networkidle');
          assert.deepEqual(navigations, ['/user/login', '/dashboard']);
          assert.equal(await page.locator('#login-form').count(), 0);
          assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth), true);
          if (test.remember) {
            assert((await context.cookies()).some(cookie => cookie.name === 'remember-me'));
            await context.clearCookies({ name: 'JSESSIONID' });
            await page.goto('/dashboard');
            assert.equal(new URL(page.url()).pathname, '/dashboard');
          }
        }
        assert.deepEqual(statuses, test.statuses, `${test.name}: response statuses`);
        assert.equal(posts, test.networkFailure ? 1 : test.statuses.length, `${test.name}: submission count`);
        assert.equal(refreshes, test.refreshes || 0, `${test.name}: token refresh count`);
        assert.deepEqual(pageErrors, [], `${test.name}: browser errors`);
        assert.deepEqual(consoleErrors, [], `${test.name}: console errors`);
        passed++;
        console.log(`PASS ${test.name}: posts=${posts}, refreshes=${refreshes}, statuses=${statuses.join(',')}`);
      } finally {
        await context.close();
      }
    }
    console.log(`PASS ${passed}/${cases.length} login recovery scenarios`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
