import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

test('Banking Pay keeps wide tables inside their own scroll panes', async ({ page }) => {
  test.setTimeout(120_000);

  const localIndexPath = resolve(__dirname, '../../index.html');
  const localMainPath = resolve(__dirname, '../../js/main.js');
  let interceptedIndex = 0;
  let interceptedMain = 0;
  const mutationRequests: string[] = [];
  const productionRequests: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) productionRequests.push(url);
    if (request.method() !== 'GET' && /\/api\/banking\/pay\/(?:batch\/(?:create-draft|[^/]+\/(?:cancel|execute-payment|schedule|prepare|retry-blocked-funds))|payment\/)/.test(url)) {
      mutationRequests.push(`${request.method()} ${new URL(url).pathname}`);
    }
  });

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      interceptedIndex += 1;
      await route.fulfill({
        path: localIndexPath,
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': 'banking-responsive-layout-index' }
      });
      return;
    }
    if (url.pathname === '/js/main.js') {
      interceptedMain += 1;
      await route.fulfill({
        path: localMainPath,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': 'banking-responsive-layout-main' }
      });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Banking', exact: true }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  const modal = page.locator('#modal');
  const modalBody = page.locator('#modalBody');
  const readyHost = page.locator('#bankingPayReadyScrollHost');
  const batchHost = page.locator('.banking-pay-batch-table-scroll');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await expect(modal).toHaveClass(/banking-modal/);
  await expect(readyHost).toBeVisible({ timeout: 60_000 });
  await expect(batchHost).toBeVisible({ timeout: 60_000 });

  const desktop = await page.evaluate(() => {
    const modalEl = document.getElementById('modal');
    const bodyEl = document.getElementById('modalBody');
    const readyEl = document.getElementById('bankingPayReadyScrollHost');
    const batchEl = document.querySelector('.banking-pay-batch-table-scroll');
    const style = bodyEl ? getComputedStyle(bodyEl) : null;
    return {
      modalWidth: modalEl?.clientWidth || 0,
      bodyWidth: bodyEl?.clientWidth || 0,
      bodyScrollWidth: bodyEl?.scrollWidth || 0,
      bodyOverflowX: style?.overflowX || '',
      readyWidth: readyEl?.clientWidth || 0,
      readyScrollWidth: readyEl?.scrollWidth || 0,
      batchWidth: (batchEl as HTMLElement | null)?.clientWidth || 0,
      batchScrollWidth: (batchEl as HTMLElement | null)?.scrollWidth || 0
    };
  });

  expect(desktop.modalWidth).toBeGreaterThan(1300);
  expect(desktop.bodyOverflowX).toBe('hidden');
  expect(desktop.bodyScrollWidth).toBeLessThanOrEqual(desktop.bodyWidth + 1);
  expect(desktop.readyWidth).toBeLessThanOrEqual(desktop.bodyWidth);
  expect(desktop.readyScrollWidth).toBeGreaterThanOrEqual(desktop.readyWidth);
  expect(desktop.batchWidth).toBeLessThanOrEqual(desktop.bodyWidth);
  expect(desktop.batchScrollWidth).toBeGreaterThanOrEqual(desktop.batchWidth);

  for (const viewport of [
    { width: 820, height: 1050, label: 'narrow tablet' },
    { width: 390, height: 844, label: 'mobile phone' }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const narrow = await page.evaluate(() => {
      const modalEl = document.getElementById('modal');
      const bodyEl = document.getElementById('modalBody');
      const readyEl = document.getElementById('bankingPayReadyScrollHost');
      const actions = document.querySelector('.banking-pay-create-toolbar .actions');
      const bodyRect = bodyEl?.getBoundingClientRect();
      const offenders = bodyEl && bodyRect
        ? Array.from(bodyEl.querySelectorAll<HTMLElement>('*'))
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                tag: el.tagName,
                id: el.id,
                className: String(el.className || '').slice(0, 80),
                width: Math.round(rect.width),
                right: Math.round(rect.right),
                bodyRight: Math.round(bodyRect.right)
              };
            })
            .filter((item) => item.right > item.bodyRight + 1)
            .sort((a, b) => b.right - a.right)
            .slice(0, 8)
        : [];
      return {
        modalWidth: modalEl?.clientWidth || 0,
        viewportWidth: window.innerWidth,
        bodyWidth: bodyEl?.clientWidth || 0,
        bodyScrollWidth: bodyEl?.scrollWidth || 0,
        readyWidth: readyEl?.clientWidth || 0,
        actionsWidth: (actions as HTMLElement | null)?.clientWidth || 0,
        offenders
      };
    });

    expect(narrow.modalWidth, viewport.label).toBeLessThanOrEqual(narrow.viewportWidth);
    expect(narrow.bodyScrollWidth, `${viewport.label}: ${JSON.stringify(narrow.offenders)}`).toBeLessThanOrEqual(narrow.bodyWidth + 1);
    expect(narrow.readyWidth, viewport.label).toBeLessThanOrEqual(narrow.bodyWidth);
    expect(narrow.actionsWidth, viewport.label).toBeLessThanOrEqual(narrow.bodyWidth);
  }
  expect(interceptedIndex).toBeGreaterThan(0);
  expect(interceptedMain).toBeGreaterThan(0);
  expect(mutationRequests).toEqual([]);
  expect(productionRequests).toEqual([]);
});
