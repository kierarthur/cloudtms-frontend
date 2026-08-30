import { expect, test, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const testOrigin = 'https://testmode.arthur-rai.co.uk';
const testBackend = 'https://test-cloudtms-backend.kier-88a.workers.dev';
const storageState = process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json';
const assets = new Map([
  ['/index.html', { body: readFileSync(resolve(root, 'index.html'), 'utf8'), type: 'text/html; charset=utf-8' }],
  ['/js/main.js', { body: readFileSync(resolve(root, 'js/main.js'), 'utf8'), type: 'application/javascript; charset=utf-8' }],
  ['/js/summary-modernisation.js', { body: readFileSync(resolve(root, 'js/summary-modernisation.js'), 'utf8'), type: 'application/javascript; charset=utf-8' }],
  ['/css/summary-modernisation.css', { body: readFileSync(resolve(root, 'css/summary-modernisation.css'), 'utf8'), type: 'text/css; charset=utf-8' }],
  ['/css/modal-modernisation.css', { body: readFileSync(resolve(root, 'css/modal-modernisation.css'), 'utf8'), type: 'text/css; charset=utf-8' }]
]);
const mainHash = createHash('sha256').update(assets.get('/js/main.js')!.body).digest('hex');

const outboxRows = [
  {
    outbox_id: 'outbox-email-1', channel: 'EMAIL', recipient_display_name: 'Kier Arthur',
    to_address: 'kier@example.test', recipient_kind: 'Candidate', subject: 'Timesheet approved',
    body_text: 'Your timesheet has been approved.', status: 'SENT', queue_state: 'COMPLETE',
    created_at_utc: '2026-08-22T02:17:56Z', effective_ready_at_utc: '2026-08-22T02:17:56Z'
  },
  {
    outbox_id: 'outbox-sms-2', channel: 'SMS', recipient_display_name: 'Test Candidate',
    to_address: '07000000000', recipient_kind: 'Candidate', body_text: 'Shift reminder',
    status: 'QUEUED', queue_state: 'READY', created_at_utc: '2026-08-22T09:30:00Z',
    scheduled_for_utc: '2026-08-22T10:00:00Z', effective_ready_at_utc: '2026-08-22T10:00:00Z'
  },
  {
    outbox_id: 'outbox-whatsapp-3', channel: 'WHATSAPP', recipient_display_name: 'Example Worker',
    to_address: '07000000001', recipient_kind: 'Candidate', body_text: 'Submission update',
    status: 'FAILED', queue_state: 'READY', created_at_utc: '2026-08-21T18:45:00Z'
  }
];

async function installLocalAssets(page: Page, state: { failList: boolean }) {
  const loaded = new Set<string>();
  await page.route(`${testBackend}/api/outbox**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === '/api/outbox' && state.failList) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'INVOICE_ASYNC_TEMPORARILY_UNAVAILABLE' }) });
      return;
    }
    if (requestUrl.pathname === '/api/outbox') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: outboxRows, total_count: outboxRows.length, has_more: false }) });
      return;
    }
    const id = decodeURIComponent(requestUrl.pathname.split('/').pop() || '');
    const row = outboxRows.find((item) => item.outbox_id === id) || outboxRows[0];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, item: row, ...row }) });
  });
  await page.route(`${testOrigin}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const asset = assets.get(path);
    if (!asset) return route.continue();
    loaded.add(path);
    const body = path === '/index.html'
      ? asset.body.replace('</head>', `<script>window.BROKER_BASE_URL=${JSON.stringify(testBackend)};window.__OUTBOX_LOCAL_PROOF=${JSON.stringify(mainHash)};</script></head>`)
      : asset.body;
    await route.fulfill({ body, contentType: asset.type, headers: { 'cache-control': 'no-store', 'x-codex-local-asset': 'outbox-summary-resilience' } });
  });
  return loaded;
}

async function openOutbox(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).__OUTBOX_LOCAL_PROOF)).toBe(mainHash);
  await page.locator('button[data-section-key="outbox"], [data-nav="outbox"]').first().click();
  await expect(page.locator('#title')).toHaveText('Outbox');
}

test('Outbox failure replaces stale summary content and retry recovers', async ({ page }) => {
  test.setTimeout(90_000);
  const state = { failList: true };
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const loaded = await installLocalAssets(page, state);
  await openOutbox(page);

  const errorState = page.locator('.ctms-summary-system-state.is-error[data-summary-section="outbox"]');
  await expect(errorState).toBeVisible();
  await expect(errorState).toContainText('Outbox is temporarily unavailable');
  await expect(page.locator('.summary-body')).toHaveCount(0);
  await expect(page.getByText('TMS Ref', { exact: true })).toHaveCount(0);

  state.failList = false;
  await errorState.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.summary-body[data-summary-section="outbox"] tbody tr')).toHaveCount(outboxRows.length);
  expect(pageErrors).toEqual([]);
  expect(loaded.has('/index.html')).toBe(true);
  expect(loaded.has('/js/main.js')).toBe(true);
  expect(loaded.has('/js/summary-modernisation.js')).toBe(true);
  expect(loaded.has('/css/summary-modernisation.css')).toBe(true);
});

const viewports = [
  { name: 'desktop', width: 1600, height: 1000, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'large phone', width: 480, height: 900, mobile: true },
  { name: 'iPad', width: 768, height: 1024, mobile: true }
];

for (const viewport of viewports) {
  test(`Outbox is usable and consistently styled on ${viewport.name}`, async ({ browser }: { browser: Browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      storageState,
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installLocalAssets(page, { failList: false });
    await openOutbox(page);

    const body = page.locator('.summary-body[data-summary-section="outbox"]');
    const rows = body.locator('tbody tr');
    await expect(body).toBeVisible();
    await expect(rows).toHaveCount(outboxRows.length);
    await expect(body).toContainText('Timesheet approved');
    await expect(body).toContainText('WHATSAPP');
    await expect(page.locator('#outboxSearchText')).toBeVisible();
    await expect(page.locator('#globalLoadingOverlay')).toHaveAttribute('aria-hidden', 'true');

    const firstRow = rows.first();
    const firstCheckbox = firstRow.locator('.outbox-row-select');
    await firstCheckbox.check();
    await expect(firstRow).toHaveClass(/ctms-row-checked/);
    await firstRow.locator('td').nth(2).click();
    await expect(firstRow).toHaveClass(/ctms-active-row/);

    if (viewport.mobile) {
      await expect(firstRow.getByRole('button', { name: /^Open / })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
      const layout = await firstRow.evaluate((element) => ({ display: getComputedStyle(element).display, height: element.getBoundingClientRect().height }));
      expect(layout.display).toBe('grid');
      expect(layout.height).toBeGreaterThan(180);
      expect(layout.height).toBeLessThan(760);
      const logout = page.locator('#btnLogout, [data-action="logout"], button').filter({ hasText: /^Logout$/ }).first();
      await expect(logout).toBeVisible();
    } else {
      const cells = firstRow.locator('td');
      const sizes = await Promise.all([1, 2, 3].map((index) => cells.nth(index).evaluate((element) => element.getBoundingClientRect().width)));
      expect(sizes[0]).toBeGreaterThan(110);
      expect(sizes[1]).toBeGreaterThan(240);
      expect(sizes[2]).toBeGreaterThan(360);
      expect(await firstRow.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(180);
      await firstRow.locator('td').nth(2).dblclick();
      await expect(page.locator('#modalTitle')).toContainText('Outbox', { timeout: 15_000 });
      await page.locator('#btnCloseModal').click();
    }

    expect(pageErrors).toEqual([]);
    await context.close();
  });
}
