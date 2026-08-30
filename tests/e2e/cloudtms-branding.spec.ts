import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const origin = 'https://testmode.arthur-rai.co.uk';
const local = new Map([
  ['/index.html', { body: readFileSync(resolve(root, 'index.html')), contentType: 'text/html; charset=utf-8' }],
  ['/assets/branding/cloudtms-office-logo-black.png', {
    body: readFileSync(resolve(root, 'assets/branding/cloudtms-office-logo-black.png')),
    contentType: 'image/png'
  }]
]);

async function openPatchedLogin(page, context) {
  const intercepted = new Map<string, number>();
  await context.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    const key = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = local.get(key);
    if (!asset) return route.continue();
    intercepted.set(key, (intercepted.get(key) || 0) + 1);
    return route.fulfill({ status: 200, contentType: asset.contentType, body: asset.body });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginOverlay').waitFor({ state: 'attached', timeout: 30_000 });
  await page.locator('#loginOverlay').evaluate(element => {
    element.style.display = 'grid';
    element.setAttribute('aria-hidden', 'false');
  });
  await expect(page.locator('#loginOverlay')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.brand')).toBeVisible();
  await expect(page.locator('.brand img')).toHaveJSProperty('naturalWidth', 1448);
  await expect(page.locator('.auth-login-logo')).toBeVisible();
  await expect(page.locator('.auth-login-logo img')).toHaveJSProperty('naturalWidth', 1448);
  expect(intercepted.get('/index.html')).toBeGreaterThan(0);
  expect(intercepted.get('/assets/branding/cloudtms-office-logo-black.png')).toBeGreaterThan(0);
  expect(intercepted.has('/assets/branding/my-tms-app-logo-black.png')).toBe(false);
}

test('Office CloudTMS branding is proportioned for desktop header and login', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await openPatchedLogin(page, context);

  const brand = await page.locator('.brand').boundingBox();
  expect(brand).not.toBeNull();
  expect(brand.width).toBeGreaterThanOrEqual(101);
  expect(brand.width).toBeLessThanOrEqual(103);
  expect(brand.height).toBeGreaterThanOrEqual(36);
  expect(brand.height).toBeLessThanOrEqual(38);

  const loginLogo = await page.locator('.auth-login-logo').boundingBox();
  const loginCard = await page.locator('#loginOverlay .auth-card').boundingBox();
  expect(loginLogo).not.toBeNull();
  expect(loginCard).not.toBeNull();
  expect(loginLogo.width).toBeGreaterThanOrEqual(359);
  expect(loginLogo.width).toBeLessThanOrEqual(361);
  expect(loginLogo.y + loginLogo.height).toBeLessThan(loginCard.y);
  expect(loginCard.y - (loginLogo.y + loginLogo.height)).toBeGreaterThanOrEqual(17);
  expect(Math.abs((loginLogo.x + loginLogo.width / 2) - 720)).toBeLessThanOrEqual(1);
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('cloudtms-branding-desktop.png'), fullPage: true });
  await context.close();
});

test('Office CloudTMS branding remains proportioned at a narrow app viewport', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await openPatchedLogin(page, context);

  const brand = await page.locator('.brand').boundingBox();
  expect(brand).not.toBeNull();
  expect(brand.width).toBeGreaterThanOrEqual(83);
  expect(brand.width).toBeLessThanOrEqual(85);
  expect(brand.height).toBeGreaterThanOrEqual(29);
  expect(brand.height).toBeLessThanOrEqual(31);

  const loginLogo = await page.locator('.auth-login-logo').boundingBox();
  const loginCard = await page.locator('#loginOverlay .auth-card').boundingBox();
  expect(loginLogo).not.toBeNull();
  expect(loginCard).not.toBeNull();
  expect(loginLogo.width).toBeGreaterThanOrEqual(295);
  expect(loginLogo.width).toBeLessThanOrEqual(297);
  expect(loginLogo.y + loginLogo.height).toBeLessThan(loginCard.y);
  expect(loginCard.y - (loginLogo.y + loginLogo.height)).toBeGreaterThanOrEqual(13);
  expect(Math.abs((loginLogo.x + loginLogo.width / 2) - 195)).toBeLessThanOrEqual(1);
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('cloudtms-branding-narrow.png'), fullPage: true });
  await context.close();
});
