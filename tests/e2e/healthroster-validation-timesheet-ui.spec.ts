import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

test('validated Weekly and Daily HealthRoster timesheets show their saved references', async ({ page }) => {
  const localFiles = new Map([
    ['/index.html', resolve(__dirname, '../../index.html')],
    ['/js/main.js', resolve(__dirname, '../../js/main.js')]
  ]);
  const localMainHash = createHash('sha256')
    .update(readFileSync(localFiles.get('/js/main.js')!))
    .digest('hex');
  const intercepted = new Set<string>();

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = localFiles.get(key);
    if (!file) return route.continue();

    intercepted.add(key);
    let body = readFileSync(file);
    if (key === '/index.html') {
      body = Buffer.from(body.toString('utf8').replace(
        '</head>',
        `<script>window.__HEALTHROSTER_VALIDATION_UI_PATCH__=${JSON.stringify(localMainHash)};</script></head>`
      ));
    }
    return route.fulfill({
      status: 200,
      body,
      contentType: key.endsWith('.js') ? 'application/javascript' : 'text/html'
    });
  });

  await page.goto('/');
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(intercepted.has('/index.html')).toBe(true);
  expect(intercepted.has('/js/main.js')).toBe(true);
  expect(await page.evaluate(() => (window as any).__HEALTHROSTER_VALIDATION_UI_PATCH__))
    .toBe(localMainHash);
  expect(await page.evaluate(() => (window as any).BROKER_BASE_URL))
    .toBe('https://test-cloudtms-backend.kier-88a.workers.dev');

  await page.evaluate(async (timesheetId) => {
    await (window as any).openTimesheet({
      id: timesheetId,
      timesheet_id: timesheetId
    });
  }, 'afd31117-1f8b-4193-8c9d-782971bdd8d8');

  const weeklyDialog = page.getByRole('dialog').last();
  await expect(weeklyDialog.getByText('Validated', { exact: true })).toBeVisible();
  await weeklyDialog.getByRole('button', { name: 'Lines', exact: true }).click();
  await expect(weeklyDialog.getByText('Ref: 726621744', { exact: true })).toBeVisible();
  await expect(weeklyDialog.getByText('Ref: 726621745', { exact: true })).toBeVisible();
  await expect(weeklyDialog.getByText('Ref: 726621746', { exact: true })).toBeVisible();
  await weeklyDialog.getByRole('button', { name: 'Close', exact: true }).click();

  await page.evaluate(async (timesheetId) => {
    await (window as any).openTimesheet({
      id: timesheetId,
      timesheet_id: timesheetId
    });
  }, 'dc19abfa-8da2-404a-804f-aa122b66f3cf');

  const dailyDialog = page.getByRole('dialog').last();
  await expect(dailyDialog.getByText('Validated', { exact: true })).toBeVisible();
  await dailyDialog.getByRole('button', { name: 'Lines', exact: true }).click();
  await expect(
    dailyDialog.getByText(/Booking Reference Number\s*–\s*0726049648/)
  ).toBeVisible();
});
