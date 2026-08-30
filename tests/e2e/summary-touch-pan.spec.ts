import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const testOrigin = 'https://testmode.arthur-rai.co.uk';
const testBackend = 'https://test-cloudtms-backend.kier-88a.workers.dev';
const storageState = process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json';
const localIndex = readFileSync(resolve(root, 'index.html'), 'utf8');
const localMain = readFileSync(resolve(root, 'js/main.js'), 'utf8');
const localSummaryJs = readFileSync(resolve(root, 'js/summary-modernisation.js'), 'utf8');
const localSummaryCss = readFileSync(resolve(root, 'css/summary-modernisation.css'), 'utf8');
const localModalCss = readFileSync(resolve(root, 'css/modal-modernisation.css'), 'utf8');
const cssHash = createHash('sha256').update(localSummaryCss).digest('hex');
const artifactDir = resolve(root, '.codex-tmp/summary-touch-pan');

type SectionKey = 'candidates' | 'clients' | 'contracts' | 'timesheets' | 'invoices' | 'outbox';
const sections: SectionKey[] = ['candidates', 'clients', 'contracts', 'timesheets', 'invoices', 'outbox'];
const outboxRows = [
  {
    outbox_id: 'touch-email-1', channel: 'EMAIL', recipient_display_name: 'Test Candidate',
    to_address: 'candidate@example.test', recipient_kind: 'Candidate', subject: 'Timesheet approved',
    body_text: 'Your timesheet has been approved.', status: 'SENT', queue_state: 'COMPLETE',
    created_at_utc: '2026-08-24T09:30:00Z', effective_ready_at_utc: '2026-08-24T09:30:00Z'
  },
  {
    outbox_id: 'touch-sms-2', channel: 'SMS', recipient_display_name: 'Test Client',
    to_address: '07000000000', recipient_kind: 'Client', body_text: 'Shift reminder',
    status: 'QUEUED', queue_state: 'READY', created_at_utc: '2026-08-24T10:00:00Z'
  }
];

async function installLocalAssets(page: Page) {
  const marker = `summary-touch:${cssHash.slice(0, 16)}`;
  const counts = { index: 0, main: 0, summaryJs: 0, summaryCss: 0, modalCss: 0 };
  await page.route(`${testBackend}/api/outbox**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/outbox') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: outboxRows, total_count: outboxRows.length, has_more: false })
      });
      return;
    }
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const row = outboxRows.find((item) => item.outbox_id === id) || outboxRows[0];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, item: row, ...row }) });
  });
  await page.route(`${testOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      counts.index += 1;
      await route.fulfill({
        body: localIndex.replace('</head>', `<script>window.BROKER_BASE_URL=${JSON.stringify(testBackend)};window.__SUMMARY_TOUCH_LOCAL_PROOF=${JSON.stringify({ marker, cssHash })};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    if (url.pathname === '/js/main.js') {
      counts.main += 1;
      await route.fulfill({ body: localMain, contentType: 'application/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' } });
      return;
    }
    if (url.pathname === '/js/summary-modernisation.js') {
      counts.summaryJs += 1;
      await route.fulfill({ body: localSummaryJs, contentType: 'application/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' } });
      return;
    }
    if (url.pathname === '/css/summary-modernisation.css') {
      counts.summaryCss += 1;
      await route.fulfill({ body: localSummaryCss, contentType: 'text/css; charset=utf-8', headers: { 'cache-control': 'no-store' } });
      return;
    }
    if (url.pathname === '/css/modal-modernisation.css') {
      counts.modalCss += 1;
      await route.fulfill({ body: localModalCss, contentType: 'text/css; charset=utf-8', headers: { 'cache-control': 'no-store' } });
      return;
    }
    await route.continue();
  });
  return { marker, counts };
}

async function openApplication(page: Page) {
  await page.goto(testOrigin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__SUMMARY_TOUCH_LOCAL_PROOF)).toEqual({
    marker: `summary-touch:${cssHash.slice(0, 16)}`,
    cssHash
  });
}

async function openSection(page: Page, section: SectionKey) {
  const button = section === 'invoices'
    ? page.locator('#nav > div').filter({ hasText: 'Invoices' }).locator('button').first()
    : page.locator(`[data-nav="${section}"]`).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('body')).toHaveAttribute('data-summary-proposal-section', section, { timeout: 30_000 });
  const body = page.locator(`.summary-body[data-summary-section="${section}"]`);
  await expect(body).toBeVisible({ timeout: 30_000 });
  await expect(body.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  return body;
}

async function touchSwipe(page: Page, target: Locator, direction: 'left' | 'right') {
  const box = await target.boundingBox();
  if (!box) throw new Error('Summary records viewport is not measurable.');
  const inset = Math.min(60, Math.max(24, box.width * 0.1));
  const startX = direction === 'left' ? box.x + box.width - inset : box.x + inset;
  const endX = direction === 'left' ? box.x + inset : box.x + box.width - inset;
  const y = box.y + Math.min(Math.max(90, box.height * 0.35), box.height - 40);
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y, radiusX: 8, radiusY: 8, force: 1 }]
  });
  for (let step = 1; step <= 10; step += 1) {
    const x = startX + ((endX - startX) * step / 10);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1 }]
    });
    await page.waitForTimeout(18);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await page.waitForTimeout(350);
}

async function withDevice(
  browser: Browser,
  viewport: { width: number; height: number },
  run: (page: Page) => Promise<void>
) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    storageState
  });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}

test('large-phone and portrait-iPad summaries accept finger swipes in both directions', async ({ browser }) => {
  test.setTimeout(360_000);
  for (const viewport of [{ width: 820, height: 1180 }, { width: 884, height: 1104 }]) {
    await withDevice(browser, viewport, async (page) => {
      const proof = await installLocalAssets(page);
      await openApplication(page);

      for (const section of sections) {
        const body = await openSection(page, section);
        const metrics = await body.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          scrollLeft: element.scrollLeft,
          touchAction: getComputedStyle(element).touchAction,
          overflowX: getComputedStyle(element).overflowX
        }));
        expect(metrics.touchAction).toContain('pan-x');
        expect(metrics.touchAction).toContain('pan-y');

        if (section === 'outbox') {
          expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);
          await expect(body.locator('tbody tr').first().locator('td[data-label="Recipient"]')).toBeVisible();
          await expect(body.locator('tbody tr').first().locator('td[data-label="Status"]')).toBeVisible();
          continue;
        }

        expect(metrics.overflowX).toBe('auto');
        expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 20);
        await body.evaluate((element) => { element.scrollLeft = 0; });
        await touchSwipe(page, body, 'left');
        const afterLeft = await body.evaluate((element) => element.scrollLeft);
        expect(afterLeft).toBeGreaterThan(5);
        await touchSwipe(page, body, 'right');
        const afterRight = await body.evaluate((element) => element.scrollLeft);
        expect(afterRight).toBeLessThan(afterLeft - 5);
      }

      mkdirSync(artifactDir, { recursive: true });
      await page.locator('#content').screenshot({ path: resolve(artifactDir, `summary-touch-${viewport.width}.png`) });
      expect(proof.counts.index).toBeGreaterThan(0);
      expect(proof.counts.main).toBeGreaterThan(0);
      expect(proof.counts.summaryJs).toBeGreaterThan(0);
      expect(proof.counts.summaryCss).toBeGreaterThan(0);
    });
  }
});

test('normal-phone summary cards expose every field without horizontal clipping', async ({ browser }) => {
  test.setTimeout(300_000);
  await withDevice(browser, { width: 390, height: 844 }, async (page) => {
    await installLocalAssets(page);
    await openApplication(page);

    for (const section of sections) {
      const body = await openSection(page, section);
      const layout = await body.evaluate((element) => {
        const row = element.querySelector('tbody tr');
        const bodyBox = element.getBoundingClientRect();
        const rowBox = row?.getBoundingClientRect();
        return {
          touchAction: getComputedStyle(element).touchAction,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          rowLeft: rowBox?.left ?? 0,
          rowRight: rowBox?.right ?? 0,
          bodyLeft: bodyBox.left,
          bodyRight: bodyBox.right,
          labelledCells: row?.querySelectorAll('td[data-label]').length ?? 0
        };
      });
      expect(layout.touchAction).toContain('pan-x');
      expect(layout.touchAction).toContain('pan-y');
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 2);
      expect(layout.rowLeft).toBeGreaterThanOrEqual(layout.bodyLeft - 1);
      expect(layout.rowRight).toBeLessThanOrEqual(layout.bodyRight + 1);
      expect(layout.labelledCells).toBeGreaterThan(0);
    }
  });
});
