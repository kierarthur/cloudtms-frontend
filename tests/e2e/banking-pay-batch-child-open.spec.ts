import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block', viewport: { width: 1600, height: 1000 } });

test.describe('orphaned Pay Batch child recovery', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

test('an orphaned Pay Batch child with a stale header owner is dismissed without removing its unrelated parent frame', async ({ page }) => {
  const localMainPath = resolve(__dirname, '../../js/main.js');
  const localMain = readFileSync(localMainPath, 'utf8');
  const helperStart = localMain.indexOf('function dismissOrphanedBankingPayBatchChildV1(options = {})');
  const helperEnd = localMain.indexOf('\n\nasync function openBankingPayBatchChildModal', helperStart);
  expect(helperStart).toBeGreaterThan(-1);
  expect(helperEnd).toBeGreaterThan(helperStart);
  const helperSource = localMain.slice(helperStart, helperEnd);

  await page.setContent(`
    <div id="modalBack" style="display:flex;">
      <div id="modal" class="modal banking-modal banking-pay-batch-child-modal">
        <div id="modalTitle">Pay Batch — a2cfddcf</div>
        <button id="btnCloseModal" data-owner-token="f:stale-child-owner">Close</button>
        <div id="modalTabs"></div>
        <div id="modalBody"><div id="orphanedPayBatchChild"></div></div>
      </div>
    </div>
  `);
  await page.addScriptTag({ content: helperSource });
  const result = await page.evaluate(() => {
    const unrelatedParent = { kind: 'banking', _token: 'f:unrelated-parent-frame' };
    (window as any).__modalStack = [unrelatedParent];
    (window as any).modalCtx = { entity: 'banking', banking: { pay: { child: null } } };
    const dismissed = (window as any).dismissOrphanedBankingPayBatchChildV1({
      source: 'e2e-stale-owner-mismatch',
      stackSnapshot: (window as any).__modalStack
    });
    return {
      dismissed,
      backdropDisplay: document.getElementById('modalBack')?.style.display,
      modalClassPresent: document.getElementById('modal')?.classList.contains('banking-pay-batch-child-modal') === true,
      bodyText: document.getElementById('modalBody')?.textContent || '',
      closeOwnerToken: document.getElementById('btnCloseModal')?.dataset?.ownerToken || '',
      parentStackDepth: (window as any).__modalStack.length,
      parentKind: (window as any).__modalStack[0]?.kind
    };
  });

  expect(result).toEqual({
    dismissed: true,
    backdropDisplay: 'none',
    modalClassPresent: false,
    bodyText: '',
    closeOwnerToken: '',
    parentStackDepth: 1,
    parentKind: 'banking'
  });
});
});

test('the full patched asset dismisses the exact handlerless Pay Batch orphan from the shared Close button', async ({ page }) => {
  test.setTimeout(90_000);

  const localIndex = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const localMain = readFileSync(resolve(__dirname, '../../js/main.js'), 'utf8');
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const localHashes = { index: sha256(localIndex), main: sha256(localMain) };
  const runtimeMarker = `banking-pay-handlerless-orphan:${localHashes.main.slice(0, 16)}`;
  let interceptedIndex = 0;
  let interceptedMain = 0;
  const mutations: string[] = [];
  const productionRequests: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) productionRequests.push(url);
    if (request.method() !== 'GET' && /\/api\/banking\/pay\//.test(url)) mutations.push(`${request.method()} ${new URL(url).pathname}`);
  });

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      interceptedIndex += 1;
      await route.fulfill({
        body: localIndex.replace('</head>', `<script>window.__CODEX_LOCAL_ASSET_PROOF=${JSON.stringify({ runtimeMarker, ...localHashes })};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': runtimeMarker }
      });
      return;
    }
    if (url.pathname === '/js/main.js') {
      interceptedMain += 1;
      await route.fulfill({
        body: localMain,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': runtimeMarker }
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({ runtimeMarker, ...localHashes });
  await expect(page.locator('html')).toHaveAttribute('data-cloudtms-main-asset-contract', '20260813-banking-fast-route-modal-r1');
  await expect(page.locator('html')).toHaveAttribute('data-banking-pay-batch-orphan-close-guard', 'installed');

  const fixture = await page.evaluate(() => {
    const modal = document.getElementById('modal');
    const back = document.getElementById('modalBack');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    const closeButton = document.getElementById('btnCloseModal') as HTMLButtonElement | null;
    (window as any).__modalStack = [];
    (window as any).__getModalFrame = () => null;
    (window as any).modalCtx = { entity: 'banking', banking: { pay: { child: null } } };
    if (modal) modal.classList.add('banking-modal', 'banking-pay-batch-child-modal');
    if (back) back.style.display = 'flex';
    if (title) title.textContent = 'Pay Batch — f2570d9b';
    if (body) body.innerHTML = '<div id="handlerlessPayBatchOrphan">Cancellation complete</div>';
    if (closeButton) {
      closeButton.dataset.ownerToken = 'f:stale-handlerless-owner';
      closeButton.onclick = null;
    }
    return {
      title: title?.textContent || '',
      backdropDisplay: back?.style.display || '',
      closeHandlerPresent: typeof closeButton?.onclick === 'function',
      modalClassPresent: modal?.classList.contains('banking-pay-batch-child-modal') === true
    };
  });
  expect(fixture).toEqual({
    title: 'Pay Batch — f2570d9b',
    backdropDisplay: 'flex',
    closeHandlerPresent: false,
    modalClassPresent: true
  });

  await page.locator('#btnCloseModal').click();
  await expect(page.locator('#modalBack')).toBeHidden();
  expect(await page.evaluate(() => ({
    title: document.getElementById('modalTitle')?.textContent || '',
    bodyText: document.getElementById('modalBody')?.textContent || '',
    ownerToken: (document.getElementById('btnCloseModal') as HTMLElement | null)?.dataset?.ownerToken || '',
    modalClassPresent: document.getElementById('modal')?.classList.contains('banking-pay-batch-child-modal') === true,
    stackDepth: Array.isArray((window as any).__modalStack) ? (window as any).__modalStack.length : -1
  }))).toEqual({ title: '', bodyText: '', ownerToken: '', modalClassPresent: false, stackDepth: 0 });

  expect(interceptedIndex).toBeGreaterThan(0);
  expect(interceptedMain).toBeGreaterThan(0);
  expect(mutations).toEqual([]);
  expect(productionRequests).toEqual([]);
});

test('double-clicking a batch opens and closes the Pay Batch child without stranding Banking', async ({ page }) => {
  test.setTimeout(180_000);

  const localIndexPath = resolve(__dirname, '../../index.html');
  const localMainPath = resolve(__dirname, '../../js/main.js');
  const localIndex = readFileSync(localIndexPath, 'utf8');
  const localMain = readFileSync(localMainPath, 'utf8');
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const localHashes = { index: sha256(localIndex), main: sha256(localMain) };
  const runtimeMarker = `banking-pay-batch-child-open:${localHashes.main.slice(0, 16)}`;
  let interceptedIndex = 0;
  let interceptedMain = 0;
  const pageErrors: string[] = [];
  const renderFailures: string[] = [];
  const mutations: string[] = [];
  const productionRequests: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('[BANKING][PAY BATCH] Overview render failed')) renderFailures.push(text);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) productionRequests.push(url);
    if (request.method() !== 'GET' && /\/api\/banking\/pay\/(?:batch\/(?:create-draft|[^/]+\/(?:cancel|execute-payment|schedule|prepare|retry-blocked-funds))|payment\/)/.test(url)) {
      mutations.push(`${request.method()} ${new URL(url).pathname}`);
    }
  });

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      interceptedIndex += 1;
      const markedIndex = localIndex.replace(
        '</head>',
        `<script>window.__CODEX_LOCAL_ASSET_PROOF=${JSON.stringify({ runtimeMarker, ...localHashes })};</script></head>`
      );
      await route.fulfill({
        body: markedIndex,
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': runtimeMarker }
      });
      return;
    }
    if (url.pathname === '/js/main.js') {
      interceptedMain += 1;
      await route.fulfill({
        body: localMain,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': runtimeMarker }
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({ runtimeMarker, ...localHashes });
  await expect(page.locator('html')).toHaveAttribute('data-cloudtms-main-asset-contract', '20260813-banking-fast-route-modal-r1');
  await expect(page.locator('html')).toHaveAttribute('data-banking-pay-batch-orphan-close-guard', 'installed');

  await page.getByRole('button', { name: 'Banking', exact: true }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  const batchPanel = page.locator('#bankingPayBatchListPanel');
  const batchRow = batchPanel.locator('tr[data-batch-id]').first();
  await expect(batchRow).toBeVisible({ timeout: 60_000 });
  const batchId = String(await batchRow.getAttribute('data-batch-id') || '');
  expect(batchId).not.toBe('');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await batchRow.dblclick();
    await expect(page.locator('#modalTitle')).toHaveText(`Pay Batch — ${batchId.slice(0, 8)}`, { timeout: 60_000 });
    await expect(page.locator('#modal')).toHaveClass(/banking-pay-batch-child-modal/);
    await expect(page.locator('#modalBody [data-banking-pay-child-overview-render-error="1"]')).toHaveCount(0);
    await expect(page.locator('#modalBody').getByText('Overview', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(page.locator('#modalTitle')).toHaveText('Banking', { timeout: 60_000 });
    await expect(page.locator('#bankingPayBatchListPanel')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
  }

  const cancelledBatchRow = batchPanel.locator('tr[data-batch-id]').filter({ hasText: /Cancelled/i }).first();
  await expect(cancelledBatchRow).toBeVisible({ timeout: 60_000 });
  const cancelledBatchId = String(await cancelledBatchRow.getAttribute('data-batch-id') || '');
  expect(cancelledBatchId).not.toBe('');
  await cancelledBatchRow.dblclick();
  await expect(page.locator('#modalTitle')).toHaveText(`Pay Batch \u2014 ${cancelledBatchId.slice(0, 8)}`, { timeout: 60_000 });
  await expect(page.locator('#modalBody')).not.toContainText('UNKNOWN', { timeout: 60_000 });
  await expect(page.locator('#modalBody')).toContainText(/Cancelled/i, { timeout: 60_000 });
  await expect(page.locator('[data-banking-pay-cancellation-progress-card="1"]')).toHaveCount(0);
  await page.waitForTimeout(10_000);
  expect(await page.evaluate(() => ({
    stackDepth: Array.isArray((window as any).__modalStack) ? (window as any).__modalStack.length : -1,
    childPresent: !!(window as any).modalCtx?.banking?.pay?.child,
    childFramePresent: Array.isArray((window as any).__modalStack) && (window as any).__modalStack.some((frame: any) => frame?.kind === 'banking-pay-batch-child')
  }))).toEqual({ stackDepth: 2, childPresent: true, childFramePresent: true });
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.locator('#modalTitle')).toHaveText('Banking', { timeout: 60_000 });
  await expect(page.locator('#bankingPayBatchListPanel')).toBeVisible({ timeout: 60_000 });
  await expect(batchPanel.locator('.mini', { hasText: /^Loading(?:\.{3}|…)$/ })).toHaveCount(0, { timeout: 60_000 });
  await expect(batchPanel.locator('tr[data-batch-id]')).toHaveCount(5, { timeout: 60_000 });

  await batchRow.dblclick();
  await expect(page.locator('#modalTitle')).toHaveText(`Pay Batch — ${batchId.slice(0, 8)}`, { timeout: 60_000 });
  const orphanFixture = await page.evaluate(() => {
    const child = (window as any).modalCtx?.banking?.pay?.child || null;
    (window as any).__modalStack = [];
    (window as any).__getModalFrame = () => null;
    const closeButton = document.getElementById('btnCloseModal') as HTMLButtonElement | null;
    if (closeButton) closeButton.onclick = null;
    return {
      childPresent: !!child,
      childOpenToken: String(child?.openToken || ''),
      modalClassPresent: document.getElementById('modal')?.classList.contains('banking-pay-batch-child-modal') === true,
      closeHandlerPresent: typeof closeButton?.onclick === 'function'
    };
  });
  expect(orphanFixture.childPresent).toBe(true);
  expect(orphanFixture.childOpenToken).not.toBe('');
  expect(orphanFixture.modalClassPresent).toBe(true);
  expect(orphanFixture.closeHandlerPresent).toBe(false);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.locator('#modalBack')).toBeHidden();
  expect(await page.evaluate(() => ({
    child: (window as any).modalCtx?.banking?.pay?.child || null,
    stackDepth: Array.isArray((window as any).__modalStack) ? (window as any).__modalStack.length : -1,
    modalClassPresent: document.getElementById('modal')?.classList.contains('banking-pay-batch-child-modal') === true
  }))).toEqual({ child: null, stackDepth: 0, modalClassPresent: false });

  expect(interceptedIndex).toBeGreaterThan(0);
  expect(interceptedMain).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  expect(renderFailures).toEqual([]);
  expect(mutations).toEqual([]);
  expect(productionRequests).toEqual([]);
});
