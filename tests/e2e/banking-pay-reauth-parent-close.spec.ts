import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({
  serviceWorkers: 'block',
  viewport: { width: 1600, height: 1000 },
  storageState: process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json'
});

test('successful payment verification restores a closable Pay Batch parent', async ({ page }) => {
  test.setTimeout(120_000);

  const localIndex = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const localMain = readFileSync(resolve(__dirname, '../../js/main.js'), 'utf8');
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const localHashes = { index: sha256(localIndex), main: sha256(localMain) };
  const runtimeMarker = `banking-pay-reauth-parent-close:${localHashes.main.slice(0, 16)}`;
  let interceptedIndex = 0;
  let interceptedMain = 0;
  let interceptedReauth = 0;
  const bankingMutations: string[] = [];
  const productionRequests: string[] = [];
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) productionRequests.push(url);
    if (request.method() !== 'GET' && /\/api\/banking\/pay\//.test(url)) {
      bankingMutations.push(`${request.method()} ${new URL(url).pathname}`);
    }
  });

  await page.route('**/auth/reauth/start', async (route) => {
    interceptedReauth += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reauth_token: 'local-test-token', tfa_required: false })
    });
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
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({ runtimeMarker, ...localHashes });
  await expect(page.locator('html')).toHaveAttribute('data-cloudtms-main-asset-contract', '20260819-banking-cancel-lifecycle-trace-r1');

  const parentBefore = await page.evaluate(() => {
    (window as any).modalCtx = {
      entity: 'banking',
      banking: { pay: { child: { batchId: 'local-modal-test' } } }
    };
    (window as any).showModal(
      'Pay Batch — local-modal-test',
      [{ key: 'main', label: 'Current Payment Status' }],
      () => '<div id="localPayBatchParent">Current Payment Status</div>',
      null,
      true,
      null,
      { kind: 'banking-pay-batch-child', noParentGate: true, showSave: false }
    );
    const stack = (window as any).__modalStack || [];
    (window as any).__localReauthPromise = (window as any).openBankingReauthModal({ purpose: 'PAYMENT_REVERSAL' });
    return { stackDepth: stack.length, parentToken: String(stack[0]?._token || '') };
  });

  expect(parentBefore.stackDepth).toBe(2);
  expect(parentBefore.parentToken).not.toBe('');
  await expect(page.locator('#modalTitle')).toHaveText('Payment verification');
  await page.locator('#bankingReauthPassword').fill('local-test-password');
  await page.locator('#bankingReauthSendCode').click();

  await expect(page.locator('#modalTitle')).toHaveText('Pay Batch — local-modal-test');
  await expect(page.locator('#localPayBatchParent')).toBeVisible();
  const restored = await page.evaluate(async () => {
    const token = await (window as any).__localReauthPromise;
    const stack = (window as any).__modalStack || [];
    const top = stack[stack.length - 1] || null;
    const closeButton = document.getElementById('btnCloseModal') as HTMLButtonElement | null;
    return {
      token,
      stackDepth: stack.length,
      topToken: String(top?._token || ''),
      closeOwnerToken: String(closeButton?.dataset?.ownerToken || ''),
      closeHandlerPresent: typeof closeButton?.onclick === 'function'
    };
  });

  expect(restored.token).toBe('local-test-token');
  expect(restored.stackDepth).toBe(1);
  expect(restored.topToken).toBe(parentBefore.parentToken);
  expect(restored.closeOwnerToken).toBe(parentBefore.parentToken);
  expect(restored.closeHandlerPresent).toBe(true);

  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.locator('#modalBack')).toBeHidden();
  expect(await page.evaluate(() => ((window as any).__modalStack || []).length)).toBe(0);

  expect(interceptedIndex).toBeGreaterThan(0);
  expect(interceptedMain).toBeGreaterThan(0);
  expect(interceptedReauth).toBe(1);
  expect(bankingMutations).toEqual([]);
  expect(productionRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
