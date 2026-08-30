import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({
  serviceWorkers: 'block',
  viewport: { width: 1600, height: 1000 },
  storageState: process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json'
});

test('PDF Evidence responds on the first click and returns to a stable Timesheet parent', async ({ page }) => {
  test.setTimeout(120_000);

  const localIndex = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const localMain = readFileSync(resolve(__dirname, '../../js/main.js'), 'utf8');
  const mainHash = createHash('sha256').update(localMain).digest('hex');
  const marker = `timesheet-evidence-parent-return:${mainHash.slice(0, 16)}`;
  let interceptedIndex = 0;
  let interceptedMain = 0;
  let interceptedPresign = 0;

  await page.route('**/api/files/presign-download', async (route) => {
    interceptedPresign += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_800));
    await route.continue();
  });

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      interceptedIndex += 1;
      await route.fulfill({
        body: localIndex.replace('</head>', `<script>window.__CODEX_LOCAL_ASSET_PROOF=${JSON.stringify({ marker, mainHash })};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    if (url.pathname === '/js/main.js') {
      interceptedMain += 1;
      await route.fulfill({
        body: localMain,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({ marker, mainHash });

  await page.locator('[data-nav="timesheets"]').click();

  const targetRow = page.locator('tr')
    .filter({ hasText: '01/03/2026' })
    .filter({ hasText: 'Kier Arthur' })
    .filter({ hasText: 'Arthur Rai Medical Services' })
    .filter({ hasText: 'Weekly Manual' })
    .filter({ hasText: '542.50' })
    .first();

  await expect(targetRow).toBeVisible({ timeout: 30_000 });
  await targetRow.dblclick();
  await expect(page.locator('#modalTitle')).toContainText('Timesheet 355efe72', { timeout: 30_000 });

  await page.locator('[data-testid="timesheet-tab-evidence"]').click();
  const evidenceRow = page.locator('#modalBody tr').filter({ hasText: 'Timesheet 1 Test.pdf' });
  await expect(evidenceRow).toBeVisible({ timeout: 30_000 });

  const parentBefore = await page.locator('#modal').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });

  const clickStartedAt = Date.now();
  await evidenceRow.getByRole('button', { name: 'View' }).click();
  await expect(page.locator('#modalTitle')).toContainText('Evidence 355efe72', { timeout: 1_200 });
  expect(Date.now() - clickStartedAt).toBeLessThan(1_200);
  await expect(page.getByText('Preparing preview…', { exact: true }).first()).toBeVisible({ timeout: 1_200 });

  await expect(page.getByRole('button', { name: 'Open / Download' })).toBeVisible({ timeout: 15_000 });
  expect(interceptedPresign).toBe(1);

  await page.locator('#btnCloseModal').click();
  const parentImmediatelyAfterClose = await page.locator('#modal').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });

  expect(Math.abs(parentImmediatelyAfterClose.left - parentBefore.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(parentImmediatelyAfterClose.top - parentBefore.top)).toBeLessThanOrEqual(2);

  await page.waitForTimeout(1_000);
  const parentAfterRefresh = await page.locator('#modal').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });

  expect(Math.abs(parentAfterRefresh.left - parentBefore.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(parentAfterRefresh.top - parentBefore.top)).toBeLessThanOrEqual(2);
  await expect(page.locator('#modalTitle')).toContainText('Timesheet 355efe72');
  await expect(page.locator('#btnRelated')).toBeVisible();
  expect(interceptedIndex).toBeGreaterThan(0);
  expect(interceptedMain).toBeGreaterThan(0);
});
