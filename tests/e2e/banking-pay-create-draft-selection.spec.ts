import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

const testFrontendHost = 'testmode.arthur-rai.co.uk';
const testBackendHost = 'test-cloudtms-backend.kier-88a.workers.dev';

async function installLocalMain(page: Page) {
  const localIndex = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const localMainPath = resolve(__dirname, '../../js/main.js');
  const localMain = readFileSync(localMainPath, 'utf8');
  const useDeployedMain = process.env.E2E_USE_DEPLOYED_MAIN === '1';
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const localHashes = { index: sha256(localIndex), main: sha256(localMain) };
  const runtimeMarker = `banking-pay-selection-result-refresh:${localHashes.main.slice(0, 16)}`;
  let interceptedIndex = 0;
  let interceptedMain = 0;
  let interceptedMainUrl = '';

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      interceptedIndex += 1;
      await route.fulfill({
        body: localIndex.replace(
          '</head>',
          `<script>window.BROKER_BASE_URL=${JSON.stringify(`https://${testBackendHost}`)};window.__CODEX_LOCAL_ASSET_PROOF=${JSON.stringify({ runtimeMarker, ...localHashes })};</script></head>`
        ),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': runtimeMarker }
      });
      return;
    }
    if (url.pathname !== '/js/main.js') {
      await route.continue();
      return;
    }
    interceptedMain += 1;
    interceptedMainUrl = url.href;
    if (useDeployedMain) {
      await route.continue();
      return;
    }
    await route.fulfill({
      body: localMain,
      contentType: 'application/javascript; charset=utf-8',
      headers: {
        'cache-control': 'no-store',
        'x-codex-local-asset': runtimeMarker
      }
    });
  });

  return Object.assign(
    () => interceptedMainUrl,
    { getProof: () => ({ interceptedIndex, interceptedMain, runtimeMarker, localHashes }) }
  );
}

async function openBankingPay(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(new URL(page.url()).hostname).toBe(testFrontendHost);

  await page.getByRole('button', { name: 'Banking', exact: true }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  const createButton = page.locator('button[data-action="banking:pay:createDraft"]');
  await expect(createButton).toBeVisible({ timeout: 60_000 });
  return createButton;
}

async function getReviewedSelectionCount(page: Page) {
  return await page.evaluate(() => {
    const wizard = window.modalCtx?.banking?.pay?.draftWizard;
    const review = wizard?.workbench?.selection_review_snapshot;
    return Array.isArray(review?.selected_preview_row_ids)
      ? review.selected_preview_row_ids.map(String).filter(Boolean).length
      : 0;
  });
}

async function getKierRecoveryPresentation(page: Page) {
  return await page.evaluate(() => {
    const collect = (hostId: string) => Array.from(document.querySelectorAll(`#${hostId} tr[data-preview-row-id]`))
      .map((row) => String(row.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.includes('CCR-00835') && text.includes('OVERPAYMENT RECOVERY'));
    const blockedText = String(document.querySelector('#bankingPayBlockedScrollHost')?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      ready: collect('bankingPayReadyScrollHost'),
      blocked: collect('bankingPayBlockedScrollHost'),
      jamesPresent: blockedText.includes('CCR-03726') && blockedText.includes('James Terwane'),
      eduardoPresent: blockedText.includes('CCR-03727') && blockedText.includes('Eduardo Almeida')
    };
  });
}

async function waitForBankingSelectionIdle(page: Page) {
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const body = document.querySelector('#modalBody');
      return body?.getAttribute('data-banking-selection-mutation-pending') !== '1';
    });
  }, { timeout: 60_000 }).toBe(true);
}

async function locateSelectionCheckboxByIdentity(page: Page, identity: { action: string; value: string }) {
  const controls = page.locator(
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
  );
  const index = await controls.evaluateAll((elements, expected) => elements.findIndex((element) => {
    const action = element.getAttribute('data-action') || '';
    const value = action === 'banking:pay:togglePreviewRow'
      ? (element.getAttribute('data-preview-row-id') || '')
      : (element.getAttribute('data-preview-row-ids') || '');
    return action === expected.action && value === expected.value;
  }), identity);
  return index >= 0 ? controls.nth(index) : null;
}

async function getReadyBlockedPresentationHash(page: Page) {
  const presentation = await page.evaluate(() => {
    const collect = (hostId: string) => Array.from(document.querySelectorAll(`#${hostId} tr[data-preview-row-id]`))
      .map((row) => ({
        id: row.getAttribute('data-preview-row-id') || '',
        text: String(row.textContent || '').replace(/\s+/g, ' ').trim(),
        selected: (row.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked === true
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      ready: collect('bankingPayReadyScrollHost'),
      blocked: collect('bankingPayBlockedScrollHost')
    };
  });
  return createHash('sha256').update(JSON.stringify(presentation)).digest('hex');
}

async function setKierTimesheetSelected(page: Page, selected: boolean) {
  const readyHost = page.locator('#bankingPayReadyScrollHost');
  await expect(readyHost).toBeVisible({ timeout: 60_000 });
  const row = readyHost.locator('tr[data-preview-row-id]')
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'TIMESHEET PAYMENT' });
  await expect(row).toHaveCount(1);
  const checkbox = row.locator(
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"], ' +
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"]'
  );
  await expect(checkbox).toHaveCount(1);
  if ((await checkbox.isChecked()) !== selected) {
    await waitForBankingSelectionIdle(page);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.hostname === testBackendHost &&
        /\/api\/banking\/pay\/workbench\/session\/[^/]+\/selected-rows$/.test(url.pathname);
    }, { timeout: 60_000 });
    await checkbox.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await waitForBankingSelectionIdle(page);
    await expect.poll(async () => {
      const currentRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
        .filter({ hasText: 'CCR-00835' })
        .filter({ hasText: 'TIMESHEET PAYMENT' });
      if (await currentRow.count() !== 1) return !selected;
      const currentCheckbox = currentRow.locator(
        'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"], ' +
        'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"]'
      );
      if (await currentCheckbox.count() !== 1) return false;
      return (await currentCheckbox.isChecked()) === selected;
    }, { timeout: 60_000 }).toBe(true);
  }
}

async function setKierRecoverySelected(page: Page, selected: boolean) {
  const row = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'OVERPAYMENT RECOVERY' });
  if (await row.count() !== 1) return;
  const checkbox = row.locator(
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
  );
  if (await checkbox.count() !== 1 || (await checkbox.isChecked()) === selected) return;
  await waitForBankingSelectionIdle(page);
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.hostname === testBackendHost &&
      /\/api\/banking\/pay\/workbench\/session\/[^/]+\/selected-rows$/.test(url.pathname);
  }, { timeout: 60_000 });
  await checkbox.click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await waitForBankingSelectionIdle(page);
  const currentRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'OVERPAYMENT RECOVERY' });
  const currentCheckbox = currentRow.locator(
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
  );
  if (selected) await expect(currentCheckbox).toBeChecked({ timeout: 60_000 });
  else await expect(currentCheckbox).not.toBeChecked({ timeout: 60_000 });
}

test('requires review and starts no draft when the authoritative selection changes', async ({ page }) => {
  test.setTimeout(120_000);

  const getInterceptedMainUrl = await installLocalMain(page);
  const unexpectedProductionBackendRequests: string[] = [];
  let simulateConcurrentChange = false;
  let modifiedPreviewResponses = 0;
  let createDraftRequests = 0;
  let simulatedRemovedRowId = '';

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'cloudtms.kier-88a.workers.dev') unexpectedProductionBackendRequests.push(url.pathname);
  });

  await page.route('**/api/banking/pay/workbench/session/*/preview-page**', async (route) => {
    const url = new URL(route.request().url());
    if (!simulateConcurrentChange || url.hostname !== testBackendHost || url.searchParams.get('section') !== 'canonical_preview_lines') {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const payload = await response.json() as Record<string, unknown>;
    const originalRows = Array.isArray(payload.rows)
      ? payload.rows
      : (Array.isArray(payload.items) ? payload.items : []);
    const selectedIndex = originalRows.findIndex((row) => {
      if (!row || typeof row !== 'object') return false;
      const value = row as Record<string, unknown>;
      const rowId = String(value.preview_row_id || value.previewRowId || value.id || '');
      return rowId === simulatedRemovedRowId && value.selected === true && String(value.status || '').toUpperCase() === 'READY';
    });
    expect(selectedIndex).toBeGreaterThanOrEqual(0);

    const rows = originalRows.filter((_row, index) => index !== selectedIndex);
    payload.rows = rows;
    payload.items = rows;
    for (const key of ['returned_count', 'returnedCount', 'known_count', 'knownCount', 'total_count', 'totalCount']) {
      if (Number.isFinite(Number(payload[key]))) payload[key] = Math.max(0, Number(payload[key]) - 1);
    }
    payload.progress_counter_version = Number(payload.progress_counter_version || 0) + 2;
    modifiedPreviewResponses += 1;

    await route.fulfill({
      response,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(payload)
    });
  });

  await page.route('**/api/banking/pay/batch/create-draft', async (route) => {
    createDraftRequests += 1;
    await route.abort('blockedbyclient');
  });

  const createButton = await openBankingPay(page);
  expect(new URL(getInterceptedMainUrl()).pathname).toBe('/js/main.js');
  test.skip(await getReviewedSelectionCount(page) < 2, 'Requires at least two current server-selected rows.');

  const hiddenConcurrentState = await page.evaluate(() => {
    const wizard = window.modalCtx?.banking?.pay?.draftWizard;
    if (!wizard?.workbench || !wizard?.decisions) throw new Error('Banking Pay wizard state is unavailable');
    const review = wizard.workbench.selection_review_snapshot;
    const reviewedIds = Array.isArray(review?.selected_preview_row_ids) ? review.selected_preview_row_ids.map(String).filter(Boolean) : [];
    if (reviewedIds.length < 2) throw new Error('Rendered Banking Pay selection snapshot is unavailable');
    const rowId = reviewedIds[0];
    const removeRowId = (value: unknown) => Array.isArray(value) ? value.map(String).filter((id) => id && id !== rowId) : value;
    for (const target of [wizard.workbench, wizard.decisions, wizard.preview?.data, wizard.preview?.data?.preview]) {
      if (!target || typeof target !== 'object') continue;
      for (const key of ['selected_preview_row_ids', 'server_selected_preview_row_ids']) {
        if (Array.isArray((target as Record<string, unknown>)[key])) {
          (target as Record<string, unknown>)[key] = removeRowId((target as Record<string, unknown>)[key]);
        }
      }
    }
    return { rowId, reviewedCount: reviewedIds.length };
  });
  simulatedRemovedRowId = hiddenConcurrentState.rowId;
  expect(hiddenConcurrentState.reviewedCount).toBeGreaterThan(1);

  simulateConcurrentChange = true;
  await createButton.click();
  const confirmButton = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();

  await expect(page.getByText('Banking Pay selection changed', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Banking Pay was changed by another user or window. The latest selection is now shown. Review it, then click Create Draft again.', { exact: true }).first()).toBeVisible();

  expect(modifiedPreviewResponses).toBeGreaterThanOrEqual(1);
  expect(createDraftRequests).toBe(0);
  expect(unexpectedProductionBackendRequests).toEqual([]);
  await page.getByRole('button', { name: 'OK', exact: true }).last().click();
});

test('an early shared-session revision drift reaches the exact selection review', async ({ page }) => {
  test.setTimeout(120_000);

  const getInterceptedMainUrl = await installLocalMain(page);
  let simulateRevisionDrift = false;
  let modifiedProgressResponses = 0;
  let modifiedPreviewResponses = 0;
  let createDraftRequests = 0;

  await page.route('**/api/banking/pay/workbench/session/*/progress**', async (route) => {
    const url = new URL(route.request().url());
    if (!simulateRevisionDrift || url.hostname !== testBackendHost) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as Record<string, unknown>;
    payload.progress_counter_version = Number(payload.progress_counter_version || 0) + 1;
    if (payload.progress && typeof payload.progress === 'object' && !Array.isArray(payload.progress)) {
      (payload.progress as Record<string, unknown>).progress_counter_version = payload.progress_counter_version;
    }
    modifiedProgressResponses += 1;
    await route.fulfill({ response, contentType: 'application/json; charset=utf-8', body: JSON.stringify(payload) });
  });

  await page.route('**/api/banking/pay/workbench/session/*/preview-page**', async (route) => {
    const url = new URL(route.request().url());
    if (!simulateRevisionDrift || url.hostname !== testBackendHost || url.searchParams.get('section') !== 'canonical_preview_lines') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as Record<string, unknown>;
    payload.progress_counter_version = Number(payload.progress_counter_version || 0) + 1;
    modifiedPreviewResponses += 1;
    await route.fulfill({ response, contentType: 'application/json; charset=utf-8', body: JSON.stringify(payload) });
  });

  await page.route('**/api/banking/pay/batch/create-draft', async (route) => {
    createDraftRequests += 1;
    await route.abort('blockedbyclient');
  });

  const createButton = await openBankingPay(page);
  expect(new URL(getInterceptedMainUrl()).pathname).toBe('/js/main.js');
  test.skip(await getReviewedSelectionCount(page) < 1, 'Requires at least one current server-selected row.');

  simulateRevisionDrift = true;
  await createButton.click();
  const confirmButton = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();

  await expect(page.getByText('Banking Pay selection changed', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Banking Pay was changed by another user or window. The latest selection is now shown. Review it, then click Create Draft again.', { exact: true }).first()).toBeVisible();
  expect(modifiedProgressResponses).toBeGreaterThanOrEqual(1);
  expect(modifiedPreviewResponses).toBeGreaterThanOrEqual(1);
  expect(createDraftRequests).toBe(0);
  await page.getByRole('button', { name: 'OK', exact: true }).last().click();
});

test('a rejected row change reloads server truth and repaints the checkbox', async ({ page }) => {
  test.setTimeout(120_000);

  const getInterceptedMainUrl = await installLocalMain(page);
  let rejectNextSelection = true;
  let rejectedSelectionRequests = 0;

  await page.route('**/api/banking/pay/workbench/session/*/selected-rows', async (route) => {
    const url = new URL(route.request().url());
    if (!rejectNextSelection || url.hostname !== testBackendHost) {
      await route.continue();
      return;
    }
    rejectNextSelection = false;
    rejectedSelectionRequests += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        ok: false,
        error_code: 'WORKBENCH_SESSION_PROGRESS_CHANGED',
        code: 'WORKBENCH_SESSION_PROGRESS_CHANGED',
        title: 'Payment selection changed',
        message: 'Banking Pay changed in another window. The latest selection has been reloaded.'
      })
    });
  });

  await openBankingPay(page);
  expect(new URL(getInterceptedMainUrl()).pathname).toBe('/js/main.js');
  const localProof = getInterceptedMainUrl.getProof();
  expect(localProof.interceptedIndex).toBeGreaterThan(0);
  expect(localProof.interceptedMain).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({
    runtimeMarker: localProof.runtimeMarker,
    ...localProof.localHashes
  });
  expect(await page.evaluate(() => (window as any).BROKER_BASE_URL)).toBe(`https://${testBackendHost}`);

  const checkbox = page.locator(
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"][data-preview-row-id], ' +
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"][data-preview-row-ids]'
  ).first();
  await expect(checkbox).toBeVisible({ timeout: 60_000 });
  const previewRowId = await checkbox.getAttribute('data-preview-row-id');
  const previewRowIds = await checkbox.getAttribute('data-preview-row-ids');
  expect(previewRowId || previewRowIds).toBeTruthy();
  const originalChecked = await checkbox.isChecked();

  await checkbox.click();
  await expect.poll(() => rejectedSelectionRequests).toBe(1);

  const repaintedCheckbox = page.locator(
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"][data-preview-row-id], ' +
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"][data-preview-row-ids]'
  ).first();
  if (originalChecked) await expect(repaintedCheckbox).toBeChecked({ timeout: 30_000 });
  else await expect(repaintedCheckbox).not.toBeChecked({ timeout: 30_000 });
});

test('a certified promoted Kier recovery renders as one selectable Ready row', async ({ page }) => {
  test.setTimeout(120_000);

  const getInterceptedMainUrl = await installLocalMain(page);
  await openBankingPay(page);
  expect(new URL(getInterceptedMainUrl()).pathname).toBe('/js/main.js');

  const readyRecoveryRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'OVERPAYMENT RECOVERY' });
  test.skip(await readyRecoveryRow.count() !== 1, 'Requires the certified Kier recovery in the current TEST materialisation.');
  const recoveryCheckbox = readyRecoveryRow.locator(
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
  );
  await expect(recoveryCheckbox).toHaveCount(1);
  await expect(recoveryCheckbox).toBeEnabled();

  const readyRecoverySourceRef = await readyRecoveryRow
    .locator('[data-source-ref]')
    .first()
    .getAttribute('data-source-ref');
  expect(readyRecoverySourceRef).toBeTruthy();
  const duplicatedBlockedRecovery = page.locator(
    `#bankingPayBlockedScrollHost tr[data-preview-row-id] [data-source-ref="${readyRecoverySourceRef}"]`
  );
  await expect(duplicatedBlockedRecovery).toHaveCount(0);
});

test('selection settlement visibly gates Create Draft until the accepted Ready and Blocked pair is installed', async ({ page }) => {
  test.setTimeout(180_000);

  const getInterceptedMainUrl = await installLocalMain(page);
  const createButton = await openBankingPay(page);
  expect(new URL(getInterceptedMainUrl()).pathname).toBe('/js/main.js');
  const localProof = getInterceptedMainUrl.getProof();
  expect(localProof.interceptedIndex).toBeGreaterThan(0);
  expect(localProof.interceptedMain).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({
    runtimeMarker: localProof.runtimeMarker,
    ...localProof.localHashes
  });

  await waitForBankingSelectionIdle(page);
  const selectable = page.locator(
    '#bankingPayReadyScrollHost input[type="checkbox"][data-action="banking:pay:togglePreviewRow"]:not(:disabled), ' +
    '#bankingPayReadyScrollHost input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]:not(:disabled)'
  ).first();
  await expect(selectable).toBeVisible({ timeout: 60_000 });
  const identity = await selectable.evaluate((element) => {
    const action = element.getAttribute('data-action') || '';
    return {
      action,
      value: action === 'banking:pay:togglePreviewRow'
        ? (element.getAttribute('data-preview-row-id') || '')
        : (element.getAttribute('data-preview-row-ids') || '')
    };
  });
  expect(identity.value).toBeTruthy();
  const originalChecked = await selectable.isChecked();

  try {
    const mutationResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.hostname === testBackendHost &&
        /\/api\/banking\/pay\/workbench\/session\/[^/]+\/selected-rows$/.test(url.pathname);
    }, { timeout: 60_000 });
    await selectable.click();
    await expect(createButton).toHaveText('Updating selection…', { timeout: 2_000 });
    await expect(createButton).toBeDisabled();
    await expect(createButton).toHaveAttribute('aria-busy', 'true');
    expect((await mutationResponse).status()).toBe(200);
    await waitForBankingSelectionIdle(page);
    await expect(createButton).not.toHaveText('Updating selection…', { timeout: 60_000 });
    await expect(createButton).not.toHaveAttribute('aria-busy', 'true');
  } finally {
    const current = await locateSelectionCheckboxByIdentity(page, identity);
    if (current && (await current.isChecked()) !== originalChecked) {
      await current.click();
      await waitForBankingSelectionIdle(page);
    }
    const restored = await locateSelectionCheckboxByIdentity(page, identity);
    expect(restored).not.toBeNull();
    expect(await restored!.isChecked()).toBe(originalChecked);
  }
});

test('one accepted selection settles through one concurrent Ready/Blocked pair and keeps the modal coherent', async ({ page }) => {
  test.setTimeout(180_000);

  const getInterceptedMainUrl = await installLocalMain(page);
  const selectedRequests: number[] = [];
  const pageRequests: Array<{ section: string; startedAt: number; endedAt?: number; status?: number }> = [];
  let observeMutation = false;
  page.on('request', (request) => {
    if (!observeMutation) return;
    const url = new URL(request.url());
    if (url.hostname !== testBackendHost) return;
    if (/\/api\/banking\/pay\/workbench\/session\/[^/]+\/selected-rows$/.test(url.pathname)) {
      selectedRequests.push(Date.now());
      return;
    }
    if (/\/api\/banking\/pay\/workbench\/session\/[^/]+\/preview-page$/.test(url.pathname)) {
      const section = url.searchParams.get('section') || '';
      if (section === 'canonical_preview_lines' || section === 'blocked_for_pay') {
        pageRequests.push({ section, startedAt: Date.now() });
      }
    }
  });
  page.on('response', (response) => {
    if (!observeMutation) return;
    const url = new URL(response.url());
    if (url.hostname !== testBackendHost || !/\/api\/banking\/pay\/workbench\/session\/[^/]+\/preview-page$/.test(url.pathname)) return;
    const section = url.searchParams.get('section') || '';
    const matching = pageRequests.find((entry) => entry.section === section && entry.endedAt === undefined);
    if (matching) {
      matching.endedAt = Date.now();
      matching.status = response.status();
    }
  });

  await openBankingPay(page);
  expect(new URL(getInterceptedMainUrl()).pathname).toBe('/js/main.js');
  const localProof = getInterceptedMainUrl.getProof();
  expect(localProof.interceptedIndex).toBeGreaterThan(0);
  expect(localProof.interceptedMain).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({
    runtimeMarker: localProof.runtimeMarker,
    ...localProof.localHashes
  });

  await waitForBankingSelectionIdle(page);
  const selectable = page.locator(
    '#bankingPayReadyScrollHost input[type="checkbox"][data-action="banking:pay:togglePreviewRow"]:not(:disabled), ' +
    '#bankingPayReadyScrollHost input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]:not(:disabled)'
  ).first();
  await expect(selectable).toBeVisible({ timeout: 60_000 });
  const identity = await selectable.evaluate((element) => {
    const action = element.getAttribute('data-action') || '';
    return {
      action,
      value: action === 'banking:pay:togglePreviewRow'
        ? (element.getAttribute('data-preview-row-id') || '')
        : (element.getAttribute('data-preview-row-ids') || '')
    };
  });
  expect(identity.value).toBeTruthy();
  const originalChecked = await selectable.isChecked();
  const initialReadyBlockedHash = await getReadyBlockedPresentationHash(page);
  const initialCasesIds = await page.locator('#bankingPayCasesScrollHost tr[data-preview-row-id]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-preview-row-id') || '').filter(Boolean)
  );

  try {
    observeMutation = true;
    const startedAt = Date.now();
    const mutationResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.hostname === testBackendHost &&
        /\/api\/banking\/pay\/workbench\/session\/[^/]+\/selected-rows$/.test(url.pathname);
    }, { timeout: 60_000 });
    await selectable.click();
    expect((await mutationResponse).status()).toBe(200);
    await waitForBankingSelectionIdle(page);
    const settledMs = Date.now() - startedAt;
    observeMutation = false;

    const current = await locateSelectionCheckboxByIdentity(page, identity);
    expect(current).not.toBeNull();
    expect(await current!.isChecked()).toBe(!originalChecked);
    console.log(`Banking Pay selection settlement: ${settledMs}ms; selected-row POSTs=${selectedRequests.length}; Ready GETs=${pageRequests.filter((entry) => entry.section === 'canonical_preview_lines').length}; Blocked GETs=${pageRequests.filter((entry) => entry.section === 'blocked_for_pay').length}`);
    expect(settledMs).toBeLessThan(20_000);
    expect(selectedRequests).toHaveLength(1);
    expect(pageRequests.filter((entry) => entry.section === 'canonical_preview_lines')).toHaveLength(1);
    expect(pageRequests.filter((entry) => entry.section === 'blocked_for_pay')).toHaveLength(1);
    expect(pageRequests.every((entry) => entry.status === 200 && Number.isFinite(entry.endedAt))).toBe(true);
    const readyRequest = pageRequests.find((entry) => entry.section === 'canonical_preview_lines')!;
    const blockedRequest = pageRequests.find((entry) => entry.section === 'blocked_for_pay')!;
    expect(Math.max(readyRequest.startedAt, blockedRequest.startedAt)).toBeLessThanOrEqual(
      Math.min(readyRequest.endedAt!, blockedRequest.endedAt!)
    );

    const presentation = await page.evaluate(() => {
      const ids = (hostId: string) => Array.from(document.querySelectorAll(`#${hostId} tr[data-preview-row-id]`))
        .map((row) => row.getAttribute('data-preview-row-id') || '')
        .filter(Boolean);
      const ready = ids('bankingPayReadyScrollHost');
      const blocked = ids('bankingPayBlockedScrollHost');
      return {
        modalVisible: document.querySelector('#modal')?.classList.contains('show') === true ||
          getComputedStyle(document.querySelector('#modal') as Element).display !== 'none',
        readyUnique: new Set(ready).size === ready.length,
        blockedUnique: new Set(blocked).size === blocked.length,
        crossSectionDuplicates: ready.filter((id) => new Set(blocked).has(id))
      };
    });
    expect(presentation.modalVisible).toBe(true);
    expect(presentation.readyUnique).toBe(true);
    expect(presentation.blockedUnique).toBe(true);
    expect(presentation.crossSectionDuplicates).toEqual([]);
    expect(await page.locator('#bankingPayCasesScrollHost tr[data-preview-row-id]').evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-preview-row-id') || '').filter(Boolean)
    )).toEqual(initialCasesIds);
  } finally {
    observeMutation = false;
    const current = await locateSelectionCheckboxByIdentity(page, identity);
    if (current && (await current.isChecked()) !== originalChecked) {
      await current.click();
      await waitForBankingSelectionIdle(page);
    }
    const restored = await locateSelectionCheckboxByIdentity(page, identity);
    expect(restored).not.toBeNull();
    expect(await restored!.isChecked()).toBe(originalChecked);
    expect(await getReadyBlockedPresentationHash(page)).toBe(initialReadyBlockedHash);
  }
});

test('Kier recovery moves atomically between Ready and Blocked as its £1 headroom is ticked', async ({ page }) => {
  test.setTimeout(300_000);

  const getInterceptedMainUrl = await installLocalMain(page);
  let selectedRowsRequestCount = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === testBackendHost && /\/api\/banking\/pay\/workbench\/session\/[^/]+\/selected-rows$/.test(url.pathname)) {
      selectedRowsRequestCount += 1;
    }
  });
  await openBankingPay(page);
  expect(new URL(getInterceptedMainUrl()).pathname).toBe('/js/main.js');
  const localProof = getInterceptedMainUrl.getProof();
  expect(localProof.interceptedIndex).toBeGreaterThan(0);
  expect(localProof.interceptedMain).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({
    runtimeMarker: localProof.runtimeMarker,
    ...localProof.localHashes
  });
  expect(await page.evaluate(() => (window as any).BROKER_BASE_URL)).toBe(`https://${testBackendHost}`);

  const initialTimesheetRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'TIMESHEET PAYMENT' });
  test.skip(await initialTimesheetRow.count() !== 1, 'Requires a Kier timesheet row in the current TEST materialisation.');
  const initialTimesheetCheckbox = initialTimesheetRow.locator(
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"], ' +
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"]'
  );
  await expect(initialTimesheetCheckbox).toHaveCount(1);
  const initialTimesheetSelected = await initialTimesheetCheckbox.isChecked();
  const initialRecoveryRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
    .filter({ hasText: 'CCR-00835' })
    .filter({ hasText: 'OVERPAYMENT RECOVERY' });
  const initialRecoveryCheckbox = initialRecoveryRow.locator(
    'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
    'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
  );
  const initialRecoverySelected = await initialRecoveryCheckbox.count() === 1
    ? await initialRecoveryCheckbox.isChecked()
    : false;

  try {
    await setKierTimesheetSelected(page, false);
    await expect.poll(async () => {
      const state = await getKierRecoveryPresentation(page);
      return {
        readyCount: state.ready.length,
        blockedCount: state.blocked.length,
        jamesPresent: state.jamesPresent,
        eduardoPresent: state.eduardoPresent
      };
    }, { timeout: 60_000 }).toEqual({
      readyCount: 0,
      blockedCount: 1,
      jamesPresent: true,
      eduardoPresent: true
    });
    let state = await getKierRecoveryPresentation(page);
    expect(state.blocked[0]).toContain('No recovery can be made because there are no available funds to deduct from this pay run.');
    expect(state.blocked[0]).toContain('1126.60');
    expect(state.blocked[0]).toContain('Insufficient funds');

    await setKierTimesheetSelected(page, true);
    await expect.poll(async () => {
      const current = await getKierRecoveryPresentation(page);
      return {
        readyCount: current.ready.length,
        blockedCount: current.blocked.length,
        jamesPresent: current.jamesPresent,
        eduardoPresent: current.eduardoPresent
      };
    }, { timeout: 60_000 }).toEqual({
      readyCount: 1,
      blockedCount: 0,
      jamesPresent: true,
      eduardoPresent: true
    });
    state = await getKierRecoveryPresentation(page);
    expect(state.ready[0]).toContain('1.00 will be recovered from the total outstanding amount of 1126.60.');
    expect(state.ready[0]).not.toContain('221.73');
    expect(state.ready[0]).not.toContain('904.87');

    const readyRecoveryRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
      .filter({ hasText: 'CCR-00835' })
      .filter({ hasText: 'OVERPAYMENT RECOVERY' });
    await expect(readyRecoveryRow).toHaveCount(1);
    const recoveryCheckbox = readyRecoveryRow.locator(
      'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
      'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
    );
    await expect(recoveryCheckbox).toHaveCount(1);
    await expect(recoveryCheckbox).not.toBeChecked();
    const recoveryControlMetadata = await recoveryCheckbox.evaluate((element) => {
      const action = element.getAttribute('data-action') || '';
      const singleIdPresent = Boolean((element.getAttribute('data-preview-row-id') || '').trim());
      let groupIdCount = 0;
      try {
        const parsed = JSON.parse(element.getAttribute('data-preview-row-ids') || '[]');
        groupIdCount = Array.isArray(parsed) ? parsed.filter(Boolean).length : 0;
      } catch {}
      return {
        action,
        identityCount: singleIdPresent ? 1 : groupIdCount,
        disabled: (element as HTMLInputElement).disabled,
        mutationPending: element.closest('#modalBody')?.getAttribute('data-banking-selection-mutation-pending') === '1'
      };
    });
    expect(recoveryControlMetadata.identityCount).toBeGreaterThan(0);
    expect(recoveryControlMetadata.disabled).toBe(false);
    expect(recoveryControlMetadata.mutationPending).toBe(false);

    const requestCountBeforeRecoverySelection = selectedRowsRequestCount;
    await recoveryCheckbox.click();
    await expect.poll(() => selectedRowsRequestCount, { timeout: 30_000 }).toBe(requestCountBeforeRecoverySelection + 1);
    await expect.poll(async () => {
      const currentRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
        .filter({ hasText: 'CCR-00835' })
        .filter({ hasText: 'OVERPAYMENT RECOVERY' });
      if (await currentRow.count() !== 1) return false;
      const currentCheckbox = currentRow.locator(
        'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
        'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
      );
      return await currentCheckbox.count() === 1 && await currentCheckbox.isChecked();
    }, { timeout: 60_000 }).toBe(true);
    await waitForBankingSelectionIdle(page);
    state = await getKierRecoveryPresentation(page);
    expect(state.ready).toHaveLength(1);
    expect(state.blocked).toHaveLength(0);
    expect(state.ready[0]).toContain('1.00 will be recovered from the total outstanding amount of 1126.60.');

    const currentRecoveryRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
      .filter({ hasText: 'CCR-00835' })
      .filter({ hasText: 'OVERPAYMENT RECOVERY' });
    const currentRecoveryCheckbox = currentRecoveryRow.locator(
      'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
      'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
    );
    const requestCountBeforeRecoveryClear = selectedRowsRequestCount;
    await currentRecoveryCheckbox.click();
    await expect.poll(() => selectedRowsRequestCount, { timeout: 30_000 }).toBe(requestCountBeforeRecoveryClear + 1);
    await expect.poll(async () => {
      const currentRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
        .filter({ hasText: 'CCR-00835' })
        .filter({ hasText: 'OVERPAYMENT RECOVERY' });
      if (await currentRow.count() !== 1) return false;
      const currentCheckbox = currentRow.locator(
        'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
        'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
      );
      return await currentCheckbox.count() === 1 && !(await currentCheckbox.isChecked());
    }, { timeout: 60_000 }).toBe(true);

    const reselectRecoveryRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
      .filter({ hasText: 'CCR-00835' })
      .filter({ hasText: 'OVERPAYMENT RECOVERY' });
    const reselectRecoveryCheckbox = reselectRecoveryRow.locator(
      'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
      'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
    );
    const requestCountBeforeRecoveryReselect = selectedRowsRequestCount;
    await reselectRecoveryCheckbox.click();
    await expect.poll(() => selectedRowsRequestCount, { timeout: 30_000 }).toBe(requestCountBeforeRecoveryReselect + 1);
    await expect.poll(async () => {
      const currentRow = page.locator('#bankingPayReadyScrollHost tr[data-preview-row-id]')
        .filter({ hasText: 'CCR-00835' })
        .filter({ hasText: 'OVERPAYMENT RECOVERY' });
      if (await currentRow.count() !== 1) return false;
      const currentCheckbox = currentRow.locator(
        'input[type="checkbox"][data-action="banking:pay:togglePreviewRow"], ' +
        'input[type="checkbox"][data-action="banking:pay:toggleTimesheetPreviewGroup"]'
      );
      return await currentCheckbox.count() === 1 && await currentCheckbox.isChecked();
    }, { timeout: 60_000 }).toBe(true);
    await waitForBankingSelectionIdle(page);

    await setKierTimesheetSelected(page, false);
    await expect.poll(async () => {
      const current = await getKierRecoveryPresentation(page);
      return {
        readyCount: current.ready.length,
        blockedCount: current.blocked.length,
        jamesPresent: current.jamesPresent,
        eduardoPresent: current.eduardoPresent
      };
    }, { timeout: 60_000 }).toEqual({
      readyCount: 0,
      blockedCount: 1,
      jamesPresent: true,
      eduardoPresent: true
    });
    state = await getKierRecoveryPresentation(page);
    expect(state.blocked[0]).toContain('No recovery can be made because there are no available funds to deduct from this pay run.');
    expect(state.blocked[0]).not.toContain('221.73');
    expect(state.blocked[0]).not.toContain('904.87');
  } finally {
    await setKierTimesheetSelected(page, initialTimesheetSelected);
    if (initialTimesheetSelected) {
      await setKierRecoverySelected(page, initialRecoverySelected);
    }
  }

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await openBankingPay(page);
  await expect.poll(async () => {
    const current = await getKierRecoveryPresentation(page);
    return {
      readyCount: current.ready.length,
      blockedCount: current.blocked.length,
      jamesPresent: current.jamesPresent,
      eduardoPresent: current.eduardoPresent
    };
  }, { timeout: 60_000 }).toEqual({
    readyCount: initialTimesheetSelected ? 1 : 0,
    blockedCount: initialTimesheetSelected ? 0 : 1,
    jamesPresent: true,
    eduardoPresent: true
  });
  const reopenedState = await getKierRecoveryPresentation(page);
  if (initialTimesheetSelected) {
    expect(reopenedState.ready).toHaveLength(1);
    expect(reopenedState.blocked).toHaveLength(0);
    expect(reopenedState.ready[0]).toContain('1.00 will be recovered from the total outstanding amount of 1126.60.');
  } else {
    expect(reopenedState.ready).toHaveLength(0);
    expect(reopenedState.blocked).toHaveLength(1);
    expect(reopenedState.blocked[0]).toContain('No recovery can be made because there are no available funds to deduct from this pay run.');
  }
  expect(reopenedState.jamesPresent).toBe(true);
  expect(reopenedState.eduardoPresent).toBe(true);
});
