import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const testOrigin = 'https://testmode.arthur-rai.co.uk';
const localIndex = readFileSync(resolve(root, 'index.html'), 'utf8');
const localMain = readFileSync(resolve(root, 'js/main.js'), 'utf8');
const localModalCss = readFileSync(resolve(root, 'css/modal-modernisation.css'), 'utf8');
const marker = `candidate-bookings-contract:${createHash('sha256').update(localMain).digest('hex').slice(0, 12)}`;
const artifactDir = resolve(root, '.codex-tmp/candidate-bookings-contract-open');

test.use({
  serviceWorkers: 'block',
  storageState: process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json'
});

async function waitForLoading(page: Page) {
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
}

async function installLocalAssets(page: Page) {
  const counts = { index: 0, main: 0, css: 0 };
  await page.route(`${testOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      counts.index += 1;
      await route.fulfill({
        body: localIndex.replace('</head>', `<script>window.__BOOKING_CONTRACT_LOCAL_PROOF=${JSON.stringify(marker)};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    if (url.pathname === '/js/main.js') {
      counts.main += 1;
      await route.fulfill({
        body: localMain,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    if (url.pathname === '/css/modal-modernisation.css') {
      counts.css += 1;
      await route.fulfill({
        body: localModalCss,
        contentType: 'text/css; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    await route.continue();
  });
  return counts;
}

async function openKierArthurBookings(page: Page) {
  await page.goto(testOrigin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await waitForLoading(page);
  expect(await page.evaluate(() => (window as any).__BOOKING_CONTRACT_LOCAL_PROOF)).toBe(marker);

  await page.locator('[data-nav="candidates"]').click();
  await waitForLoading(page);
  const quickSearch = page.locator('#quickSearch');
  const row = page.locator('.summary-body[data-summary-section="candidates"] tr[data-id]')
    .filter({ has: page.locator('td').filter({ hasText: /^\s*Arthur\s*$/ }) })
    .filter({ has: page.locator('td').filter({ hasText: /^\s*Kier\s*$/ }) })
    .first();
  for (const query of ['Kier Arthur', 'Kier', 'Arthur']) {
    await quickSearch.fill(query);
    await quickSearch.press('Enter');
    await waitForLoading(page);
    await page.waitForTimeout(1_200);
    if (await row.isVisible().catch(() => false)) break;
  }
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.dblclick();
  await expect(page.locator('#modalTitle')).toContainText('Candidate', { timeout: 30_000 });
  await waitForLoading(page);
  await page.locator('#modalTabs button').filter({ hasText: /^\s*Bookings\s*$/ }).click();
  await waitForLoading(page);
  await expect(page.locator('.candidate-contract-row').first()).toBeVisible({ timeout: 30_000 });
}

async function openBookingContract(page: Page, trigger: 'button' | 'row') {
  const row = page.locator('.candidate-contract-row').first();
  const contractId = await row.getAttribute('data-contract-id');
  expect(contractId).toBeTruthy();
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/contracts/${contractId}`;
  }, { timeout: 30_000 });

  if (trigger === 'button') await row.getByRole('button', { name: 'Open', exact: true }).click();
  else await row.dblclick();

  expect((await responsePromise).status()).toBe(200);
  await expect(page.locator('#modalTitle')).toContainText('View Contract', { timeout: 30_000 });
  await expect(page.locator('#modalTitle .ctms-contract-title-lock')).toBeVisible();
  await waitForLoading(page);
  await expect(page.locator('#contractForm')).toBeVisible();
  await expect(page.locator('#btnEditModal')).toBeVisible();
  await page.locator('#btnEditModal').click();
  await expect.poll(() => page.evaluate(() => (window as any).__getModalFrame?.()?.mode)).toBe('edit');
  await expect(page.locator('#contractForm input[name="display_site"]')).toBeEnabled();
  for (const selector of [
    '#contractForm input[name="candidate_id"]',
    '#contractForm input[name="client_id"]',
    '#candidate_name_display',
    '#client_name_display',
    '#contractForm input[name="role"]',
    '#contractForm input[name="start_date"]',
    '#contractForm input[name="end_date"]'
  ]) {
    await expect(page.locator(selector)).not.toHaveValue('');
  }
}

async function verifyAllContractTabs(page: Page) {
  await page.locator('#modalTabs button').filter({ hasText: /^\s*Rates\s*$/ }).click();
  await expect(page.locator('#contractRatesTab')).toBeVisible();
  expect(await page.locator('#contractRatesTab input').count()).toBeGreaterThan(0);

  await page.locator('#modalTabs button').filter({ hasText: /^\s*Additional Rates\s*$/ }).click();
  await expect(page.locator('#contractAdditionalRatesTab')).toBeVisible();
  await expect(page.locator('#contractAdditionalRatesTab .contract-extra-rate-card')).toHaveCount(5);

  await page.locator('#modalTabs button').filter({ hasText: /^\s*Calendar\s*$/ }).click();
  await expect(page.locator('#contractCalendarHolder')).toBeVisible();
  await expect(page.locator('#__calScroll')).toBeVisible({ timeout: 30_000 });

  await page.locator('#modalTabs button').filter({ hasText: /^\s*Main\s*$/ }).click();
  await expect(page.locator('#contractForm')).toBeVisible();
}

for (const viewport of [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'phone', width: 390, height: 844 },
  { label: 'large-phone', width: 430, height: 932 },
  { label: 'ipad', width: 820, height: 1180 }
]) {
  test(`Candidate Bookings opens a fully hydrated contract on ${viewport.label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const counts = await installLocalAssets(page);
    await openKierArthurBookings(page);
    await openBookingContract(page, 'button');
    await verifyAllContractTabs(page);

    const modalBox = await page.locator('#modal').boundingBox();
    expect(modalBox).not.toBeNull();
    expect(modalBox!.x).toBeGreaterThanOrEqual(0);
    expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    mkdirSync(artifactDir, { recursive: true });
    await page.locator('#modal').screenshot({ path: resolve(artifactDir, `hydrated-contract-${viewport.label}.png`) });

    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.locator('#modalTitle')).toContainText('Candidate');
    await expect(page.locator('.candidate-contracts-table')).toBeVisible();

    if (viewport.label === 'desktop') {
      await openBookingContract(page, 'row');
      await expect(page.locator('#contractForm')).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).last().click();
      await expect(page.locator('#modalTitle')).toContainText('Candidate');
    }

    expect(counts.index).toBeGreaterThan(0);
    expect(counts.main).toBeGreaterThan(0);
    expect(counts.css).toBeGreaterThan(0);
  });
}
