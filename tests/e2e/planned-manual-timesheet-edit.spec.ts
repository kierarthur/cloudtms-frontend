import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

test('a planned Manual week keeps Edit and Process available immediately after save', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(30_000);
  const contractWeekId = '038bd1e5-46ff-4203-bb7f-ea2fa75b3a1a';
  const mondayDate = '2026-03-30';
  const originalMondayEnd = '21:00';
  const temporaryMondayEnd = '20:59';
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
        `<script>window.__PLANNED_MANUAL_EDIT_PATCH__=${JSON.stringify(localMainHash)};</script></head>`
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
  expect(await page.evaluate(() => (window as any).__PLANNED_MANUAL_EDIT_PATCH__)).toBe(localMainHash);

  const openTarget = async () => {
    const result = await page.evaluate(async (targetId) => {
      const rows = await (window as any).listTimesheetsSummary({
        q: 'Kier Arthur',
        tools_stage: 'UNPROCESSED',
        week_ending_from: '2026-04-05',
        week_ending_to: '2026-04-05'
      });
      const row = (Array.isArray(rows) ? rows : []).find((candidate: any) => (
        String(candidate?.contract_week_id || candidate?.id || '') === targetId
      ));
      if (!row) return { ok: false, returnedCount: Array.isArray(rows) ? rows.length : 0 };
      await (window as any).openTimesheet(row);
      return { ok: true };
    }, contractWeekId);
    expect(result).toEqual({ ok: true });
    await expect(page.getByRole('dialog')).toContainText('Weekly timesheet (planned) 038bd1e5', { timeout: 30_000 });
    await expect(page.locator('#btnEditModal')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#btnEditModal')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('#btnTsProcessTimesheet')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#btnTsProcessTimesheet')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('#btnTsAuthorise')).toBeHidden();
  };

  const editMondayEndAndSave = async (nextEnd: string) => {
    await page.locator('#btnEditModal').evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole('dialog').getByRole('button', { name: 'Lines', exact: true }).click();
    const mondayEnd = page.locator(
      `input[data-weekly-field="end"][data-date="${mondayDate}"][data-line-idx="0"]`
    );
    await expect(mondayEnd).toBeVisible({ timeout: 30_000 });
    await expect(mondayEnd).toBeEnabled();
    await mondayEnd.fill(nextEnd);
    await mondayEnd.blur();
    await page.locator('#btnSave').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator('#btnEditModal')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#btnEditModal')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('#btnTsProcessTimesheet')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#btnTsProcessTimesheet')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('#btnTsAuthorise')).toBeHidden();
  };

  let temporaryValueSaved = false;
  await openTarget();
  try {
    await editMondayEndAndSave(temporaryMondayEnd);
    temporaryValueSaved = true;

    // The regression happened here: without closing the modal, all footer
    // actions were disabled and Authorise was incorrectly exposed.
    await page.getByRole('dialog').getByRole('button', { name: 'Lines', exact: true }).click();
    await expect(page.locator(
      `input[data-weekly-field="end"][data-date="${mondayDate}"][data-line-idx="0"]`
    )).toHaveValue(temporaryMondayEnd);
  } finally {
    if (temporaryValueSaved) {
      await editMondayEndAndSave(originalMondayEnd);
      temporaryValueSaved = false;
    }
  }

  await page.locator('#btnCloseModal').click();
  await openTarget();
  await page.getByRole('dialog').getByRole('button', { name: 'Lines', exact: true }).click();
  await expect(page.locator(
    `input[data-weekly-field="end"][data-date="${mondayDate}"][data-line-idx="0"]`
  )).toHaveValue(originalMondayEnd);
});
