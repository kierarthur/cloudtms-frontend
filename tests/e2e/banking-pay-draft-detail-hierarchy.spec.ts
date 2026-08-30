import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block', viewport: { width: 768, height: 900 } });

const BATCH_ID = '6ff3a0d0-64dc-48ce-a983-f51566d33b19';

test('uses frozen draft context and a week/client/timesheet hierarchy without re-offering the reserved recovery', async ({ page }) => {
  test.setTimeout(180_000);

  const localMainPath = resolve(__dirname, '../../js/main.js');
  const normalTestBackendRequests: string[] = [];
  const productionBackendRequests: string[] = [];
  const batchDetailRequests: string[] = [];
  const mutationRequests: string[] = [];
  let interceptedMainUrl = '';

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://test-cloudtms-backend.kier-88a.workers.dev/')) normalTestBackendRequests.push(url);
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) productionBackendRequests.push(url);
    if (url.includes(`/api/banking/pay/batch/${BATCH_ID}`)) batchDetailRequests.push(url);
    if (
      request.method() !== 'GET'
      && /\/api\/banking\/pay\/batch\/(create-draft|[^/]+\/(cancel|execute-payment|schedule|prepare|retry-blocked-funds))/.test(url)
    ) mutationRequests.push(`${request.method()} ${url}`);
  });

  await page.route('**/js/main.js', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'testmode.arthur-rai.co.uk' || url.pathname !== '/js/main.js') {
      await route.continue();
      return;
    }
    interceptedMainUrl = url.href;
    await route.fulfill({
      path: localMainPath,
      contentType: 'application/javascript; charset=utf-8',
      headers: {
        'cache-control': 'no-store',
        'x-codex-local-asset': 'banking-pay-draft-detail-hierarchy'
      }
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(interceptedMainUrl).toBe('https://testmode.arthur-rai.co.uk/js/main.js');

  await page.getByRole('button', { name: 'Banking' }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  const readyHost = page.locator('#bankingPayReadyScrollHost');
  await expect(readyHost).toBeVisible({ timeout: 60_000 });
  const reservedRecovery = readyHost
    .locator('tr')
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'OVERPAYMENT RECOVERY' });
  await expect(reservedRecovery).toHaveCount(0);

  const batchRow = page.locator(`#bankingPayBatchListPanel tr[data-batch-id="${BATCH_ID}"]`);
  await expect(batchRow).toBeVisible({ timeout: 60_000 });
  await batchRow.dblclick();

  await expect(page.getByText('Pay Batch — 6ff3a0d0', { exact: true })).toBeVisible({ timeout: 60_000 });
  const candidateRow = page
    .locator('tr')
    .filter({ has: page.locator('[data-action="banking:pay:child:toggleExpandCandidate"]') })
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'Kier Arthur' })
    .first();
  await expect(candidateRow).toContainText('5 timesheets · 7 payment items');
  await expect(candidateRow).toContainText('£1120.93');
  await candidateRow.locator('[data-action="banking:pay:child:toggleExpandCandidate"]').click();

  const detailRow = candidateRow.locator('xpath=following-sibling::tr[1]');
  await expect(detailRow.getByText('Week ending 19 April 2026', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(detailRow.getByText('Week ending 10 May 2026', { exact: true })).toBeVisible();
  await expect(detailRow.getByText('Week ending 12 April 2026', { exact: true })).toBeVisible();
  await expect(detailRow.getByText('Week ending 5 April 2026', { exact: true })).toBeVisible();
  await expect(detailRow.getByText('Week ending 8 February 2026', { exact: true })).toBeVisible();
  await expect(detailRow.getByText('Week ending not recorded', { exact: true })).toHaveCount(0);
  await expect(detailRow).toContainText('£702.15');
  await expect(detailRow).toContainText('£380.00');
  await expect(detailRow).toContainText('£17.39');
  await expect(detailRow).toContainText('£23.00');
  await expect(detailRow).toContainText('£1.00');

  const weekButton = detailRow.getByRole('button', { name: 'Expand Week ending 19 April 2026', exact: true });
  const weekLabel = detailRow.getByText('Week ending 19 April 2026', { exact: true });
  expect(Number(await weekLabel.evaluate((node) => getComputedStyle(node).fontWeight))).toBeGreaterThanOrEqual(700);
  await weekButton.click();

  const clientLabel = detailRow.getByText('Berkshire Healthcare NHS Foundation Trust', { exact: true });
  await expect(clientLabel).toBeVisible();
  expect(Number(await clientLabel.evaluate((node) => getComputedStyle(node).fontWeight))).toBeLessThan(700);
  await detailRow.getByRole('button', { name: 'Expand client Berkshire Healthcare NHS Foundation Trust', exact: true }).click();

  const timesheetLabel = detailRow.locator('span.mini').filter({ hasText: /^Timesheet(?:\s|$|—)/ }).first();
  await expect(timesheetLabel).toBeVisible();
  expect(Number(await timesheetLabel.evaluate((node) => getComputedStyle(node).fontWeight))).toBeLessThan(700);
  expect(await timesheetLabel.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  await detailRow.locator('[data-action="banking:pay:child:toggleCandidateDetailGroup"][aria-label^="Expand Timesheet"]').click();

  const lineTable = detailRow.locator('table.grid').filter({ hasText: 'Description' }).first();
  await expect(lineTable).toBeVisible();
  await expect(lineTable.locator('thead')).toContainText('Description');
  await expect(lineTable.locator('tbody tr')).not.toHaveCount(0);
  const lineText = await lineTable.innerText();
  expect(lineText).not.toMatch(/SEGMENT_DELTA|EXPENSE_DELTA|TS_DAY|EXPENSE_CODE/);
  expect(lineText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);

  const adjustments = detailRow.locator('section').filter({ hasText: 'Adjustments and recoveries' });
  await expect(adjustments).toContainText('£-2.61');
  await adjustments.getByRole('button', { name: 'Expand adjustments and recoveries', exact: true }).click();
  await expect(adjustments).toContainText('Overpayment recovery');
  await expect(adjustments).toContainText('£-2.61');

  const detailSections = detailRow.locator('td[colspan="4"] > div > div > section');
  expect(await detailSections.count()).toBeGreaterThanOrEqual(5);
  const detailLayout = await detailSections.evaluateAll((sections) => {
    const container = sections[0]?.parentElement;
    const rectangles = sections.map((section) => {
      const rect = section.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        flexShrink: getComputedStyle(section).flexShrink
      };
    });
    return {
      clientHeight: container?.clientHeight || 0,
      scrollHeight: container?.scrollHeight || 0,
      rectangles
    };
  });
  expect(detailLayout.rectangles.every((rect) => rect.flexShrink === '0')).toBe(true);
  for (let index = 1; index < detailLayout.rectangles.length; index += 1) {
    expect(detailLayout.rectangles[index].top).toBeGreaterThanOrEqual(detailLayout.rectangles[index - 1].bottom - 0.5);
  }
  expect(detailLayout.scrollHeight).toBeGreaterThan(detailLayout.clientHeight);

  await expect(detailRow).not.toContainText('Client not recorded');
  await expect(detailRow).toContainText('Displayed frozen total');
  await expect(detailRow).toContainText('£1120.93');

  await page.waitForTimeout(2_000);
  expect(normalTestBackendRequests.length).toBeGreaterThan(0);
  expect(productionBackendRequests).toEqual([]);
  expect(mutationRequests).toEqual([]);
  expect(batchDetailRequests.length).toBeLessThan(20);
});
