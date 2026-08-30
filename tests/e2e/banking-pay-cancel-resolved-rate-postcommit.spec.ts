import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });

test('accepted clear survives valid representation variants and rejects genuinely foreign scope', async ({ page }) => {
  test.setTimeout(120_000);

  const testBackend = 'https://test-cloudtms-backend.kier-88a.workers.dev';
  const localIndex = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const localMain = readFileSync(resolve(__dirname, '../../js/main.js'), 'utf8');
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const localHashes = { index: sha256(localIndex), main: sha256(localMain) };
  const runtimeMarker = `banking-james-cancel-postcommit:${localHashes.main.slice(0, 16)}`;
  let interceptedIndex = 0;
  let interceptedMain = 0;
  const unexpectedProductionRequests: string[] = [];
  const mutationRequests: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) unexpectedProductionRequests.push(url);
    if (request.method() !== 'GET' && /\/api\/banking\/pay\//.test(url)) {
      mutationRequests.push(`${request.method()} ${new URL(url).pathname}`);
    }
  });

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      interceptedIndex += 1;
      const body = localIndex.replace(
        '</head>',
        `<script>window.BROKER_BASE_URL=${JSON.stringify(testBackend)};window.__CODEX_LOCAL_ASSET_PROOF=${JSON.stringify({ runtimeMarker, ...localHashes })};</script></head>`
      );
      await route.fulfill({
        body,
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
  await expect(page.locator('html')).toHaveAttribute(
    'data-cloudtms-main-asset-contract',
    '20260817-banking-james-cancel-postcommit-r1'
  );
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(await page.evaluate(() => (window as any).BROKER_BASE_URL)).toBe(testBackend);
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({ runtimeMarker, ...localHashes });

  const browserResult = await page.evaluate(async () => {
    const appWindow = window as typeof window & {
      bankingPayWorkbenchSessionClearCaseResolution?: (...args: any[]) => Promise<any>;
      openUiConfirmModal?: (...args: any[]) => Promise<any>;
      openBankingPayCancelResolvedRatesModal?: (...args: any[]) => Promise<any>;
      normaliseResolvedRateClearRefreshScopeV1?: (...args: any[]) => any;
    };
    const SESSION = '11111111-1111-4111-8111-111111111111';
    const CANDIDATE = '22222222-2222-4222-8222-222222222222';
    const ANCHOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const LINKED_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const LINKED_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    if (
      typeof appWindow.openBankingPayCancelResolvedRatesModal !== 'function' ||
      typeof appWindow.normaliseResolvedRateClearRefreshScopeV1 !== 'function'
    ) {
      throw new Error('The patched resolved-rate clear helpers are unavailable.');
    }

    const expectedContext = {
      session_id: SESSION,
      candidate_id: CANDIDATE,
      anchor_timesheet_id: ANCHOR,
      expected_affected_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B]
    };
    const verifiedVariant = appWindow.normaliseResolvedRateClearRefreshScopeV1({
      ok: true,
      session_id: SESSION,
      session_version: 12,
      candidate_id: CANDIDATE,
      anchor_timesheet_id: ANCHOR,
      affected_timesheet_ids: [LINKED_B.toUpperCase(), ANCHOR, LINKED_A, LINKED_A.toUpperCase()],
      linked_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B, ANCHOR]
    }, expectedContext);
    const foreignVariant = appWindow.normaliseResolvedRateClearRefreshScopeV1({
      ok: true,
      session_id: SESSION,
      session_version: 12,
      candidate_id: CANDIDATE,
      anchor_timesheet_id: ANCHOR,
      targeted_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B, FOREIGN],
      linked_timesheet_ids: [LINKED_A, LINKED_B, FOREIGN],
      total_affected_timesheet_count: 4,
      eligible_linked_timesheet_count: 3
    }, expectedContext);

    const originalClear = appWindow.bankingPayWorkbenchSessionClearCaseResolution;
    const originalConfirm = appWindow.openUiConfirmModal;
    let discoveryCalls = 0;
    let mutationCalls = 0;
    try {
      appWindow.openUiConfirmModal = async () => ({ confirmed: true });
      appWindow.bankingPayWorkbenchSessionClearCaseResolution = async () => {
        discoveryCalls += 1;
        return {
          ok: true,
          operation: 'LIST_CLEARABLE',
          session_id: SESSION,
          session_version: 11,
          progress_counter_version: 7,
          candidate_id: CANDIDATE,
          anchor_timesheet_id: ANCHOR,
          anchor_case_key: `timesheet:${ANCHOR}`,
          clearable_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B],
          clearable_linked_timesheet_ids: [LINKED_A, LINKED_B],
          eligible_linked_timesheet_count: 2,
          total_affected_timesheet_count: 3,
          excluded_linked_timesheets: [],
          excluded_linked_timesheet_count: 0
        };
      };
      const acceptedForeign = await appWindow.openBankingPayCancelResolvedRatesModal({
        workbench_session_id: SESSION,
        session_version: 11,
        expected_progress_counter_version: 7,
        candidate_id: CANDIDATE,
        clicked_timesheet_id: ANCHOR,
        clicked_case_key: `timesheet:${ANCHOR}`,
        onConfirm: async () => {
          mutationCalls += 1;
          return {
            ok: true,
            session_id: SESSION,
            session_version: 12,
            candidate_id: CANDIDATE,
            anchor_timesheet_id: ANCHOR,
            targeted_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B, FOREIGN],
            linked_timesheet_ids: [LINKED_A, LINKED_B, FOREIGN],
            total_affected_timesheet_count: 4,
            eligible_linked_timesheet_count: 3
          };
        }
      });
      return {
        verifiedVariant,
        foreignVariant,
        acceptedForeign,
        discoveryCalls,
        mutationCalls
      };
    } finally {
      appWindow.bankingPayWorkbenchSessionClearCaseResolution = originalClear;
      appWindow.openUiConfirmModal = originalConfirm;
    }
  });

  expect(browserResult.verifiedVariant.scopeVerified).toBe(true);
  expect(browserResult.verifiedVariant.canonicalLinkedTimesheetIds).toEqual([
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ]);
  expect(browserResult.foreignVariant.scopeVerified).toBe(false);
  expect(browserResult.foreignVariant.verificationDetail.issues).toContain('AFFECTED_SET_UNEXPECTED_TARGET');
  expect(browserResult.acceptedForeign.accepted).toBe(true);
  expect(browserResult.acceptedForeign.mutation_accepted).toBe(true);
  expect(browserResult.acceptedForeign.refresh_scope_verified).toBe(false);
  expect(browserResult.acceptedForeign.requires_canonical_refresh).toBe(true);
  expect(browserResult.acceptedForeign.verification_code).toBe('BANKING_PAY_RESOLVED_RATE_CLEAR_SCOPE_UNVERIFIED_AFTER_COMMIT');
  expect(browserResult.discoveryCalls).toBe(1);
  expect(browserResult.mutationCalls).toBe(1);
  expect(interceptedIndex).toBeGreaterThan(0);
  expect(interceptedMain).toBeGreaterThan(0);
  expect(mutationRequests).toEqual([]);
  expect(unexpectedProductionRequests).toEqual([]);
});
