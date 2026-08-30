import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const testOrigin = 'https://testmode.arthur-rai.co.uk';
const testBackend = 'https://test-cloudtms-backend.kier-88a.workers.dev';
const localMain = readFileSync(resolve(root, 'js/main.js'), 'utf8');
const localMainHash = createHash('sha256').update(localMain).digest('hex');

test.use({
  serviceWorkers: 'block',
  storageState: { cookies: [], origins: [] }
});

async function installLocalMain(page: Page) {
  let mainRequests = 0;
  await page.route(`${testOrigin}/js/main.js**`, async (route) => {
    mainRequests += 1;
    await route.fulfill({
      body: `${localMain}\nwindow.__OFFICE_AUTH_REFRESH_LOCAL_PROOF=${JSON.stringify(localMainHash)};`,
      contentType: 'application/javascript; charset=utf-8',
      headers: { 'cache-control': 'no-store', 'x-codex-local-main': localMainHash }
    });
  });
  return () => mainRequests;
}

async function seedOfficeSession(page: Page) {
  await page.evaluate(() => {
    (window as any).__authState = 'AUTHENTICATED';
    (window as any).saveSession({
      accessToken: 'codex-seeded-access-token',
      user: { id: 'codex-user', email_signature_html: null },
      policy: { idle_logout_seconds: 7200, idle_warning_seconds: 300 },
      exp: Math.floor(Date.now() / 1000) + 900
    });
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
  });
}

test('DNS and uncoded edge failures preserve the Office session; a coded invalid refresh logs out', async ({ page }) => {
  const mainRequestCount = await installLocalMain(page);
  let mode: 'dns' | 'uncoded401' | 'success' | 'invalid' = 'dns';
  let refreshRequests = 0;

  await page.route(`${testBackend}/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true })
  }));
  await page.route(`${testBackend}/auth/refresh`, async (route) => {
    refreshRequests += 1;
    if (mode === 'dns') return route.abort('namenotresolved');
    if (mode === 'uncoded401') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorised' }) });
    }
    if (mode === 'invalid') {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Session not found', code: 'REFRESH_SESSION_MISSING' })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'codex-renewed-access-token', expires_in: 900 })
    });
  });
  await page.goto(testOrigin, { waitUntil: 'domcontentloaded' });
  await expect.poll(mainRequestCount).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__OFFICE_AUTH_REFRESH_LOCAL_PROOF)).toBe(localMainHash);
  await seedOfficeSession(page);

  expect(await page.evaluate(() => (window as any).refreshToken())).toBeNull();
  expect(await page.evaluate(() => (window as any).__authState)).toBe('AUTHENTICATED');
  await expect(page.locator('#loginOverlay')).toBeHidden();

  mode = 'uncoded401';
  expect(await page.evaluate(() => (window as any).refreshToken())).toBeNull();
  expect(await page.evaluate(() => (window as any).__authState)).toBe('AUTHENTICATED');
  await expect(page.locator('#loginOverlay')).toBeHidden();

  mode = 'success';
  expect(await page.evaluate(() => (window as any).refreshToken())).toBe(true);
  expect(await page.evaluate(() => (window as any).__authState)).toBe('AUTHENTICATED');
  await expect(page.locator('#loginOverlay')).toBeHidden();

  mode = 'invalid';
  expect(await page.evaluate(() => (window as any).refreshToken())).toBe(false);
  expect(await page.evaluate(() => (window as any).__authState)).toBe('LOGGED_OUT');
  await expect(page.locator('#loginOverlay')).toBeVisible();
  expect(refreshRequests).toBeGreaterThanOrEqual(4);
});

test('parallel callers still share one refresh request', async ({ page }) => {
  const mainRequestCount = await installLocalMain(page);
  let refreshRequests = 0;
  await page.route(`${testBackend}/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true })
  }));
  await page.route(`${testBackend}/auth/refresh`, async (route) => {
    refreshRequests += 1;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'codex-renewed-access-token', expires_in: 900 })
    });
  });
  await page.goto(testOrigin, { waitUntil: 'domcontentloaded' });
  await expect.poll(mainRequestCount).toBeGreaterThan(0);
  await seedOfficeSession(page);
  const results = await page.evaluate(() => Promise.all([
    (window as any).refreshToken(),
    (window as any).refreshToken(),
    (window as any).refreshToken()
  ]));
  expect(results).toEqual([true, true, true]);
  expect(refreshRequests).toBe(1);
});
