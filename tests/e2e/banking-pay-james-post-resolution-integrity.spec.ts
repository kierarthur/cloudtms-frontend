import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block', viewport: { width: 1600, height: 1100 } });

test('renders exact DAY and NIGHT authority with one whole-timesheet Cancel Resolved Rate action', async ({ page }) => {
  test.setTimeout(120_000);

  const testBackend = 'https://test-cloudtms-backend.kier-88a.workers.dev';
  const localIndex = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const localMain = readFileSync(resolve(__dirname, '../../js/main.js'), 'utf8');
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const localHashes = { index: sha256(localIndex), main: sha256(localMain) };
  const runtimeMarker = `banking-james-post-resolution:${localHashes.main.slice(0, 16)}`;
  let interceptedIndex = 0;
  let interceptedMain = 0;
  const unexpectedProductionRequests: string[] = [];
  const prohibitedMutationRequests: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) unexpectedProductionRequests.push(url);
    if (
      request.method() !== 'GET' &&
      /\/api\/banking\/pay\/(?:workbench\/session\/(?:clear-case-resolution|save-case-resolution)|batch\/(?:create-draft|[^/]+\/(?:cancel|execute-payment|schedule|prepare|retry-blocked-funds))|payment\/|provider\/|settlement\/|remittance\/)/.test(url)
    ) {
      prohibitedMutationRequests.push(`${request.method()} ${new URL(url).pathname}`);
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
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(await page.evaluate(() => (window as any).BROKER_BASE_URL)).toBe(testBackend);
  expect(await page.evaluate(() => (window as any).__CODEX_LOCAL_ASSET_PROOF)).toEqual({ runtimeMarker, ...localHashes });
  await expect(page.locator('html')).toHaveAttribute(
    'data-cloudtms-main-asset-contract',
    '20260818-banking-finance-cancel-restore-adoption-r3'
  );

  await page.getByRole('button', { name: 'Banking', exact: true }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  const readyHost = page.locator('#bankingPayReadyScrollHost');
  await expect(readyHost).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#bankingPayPreviewProgress[data-progress-active="false"]')).toBeVisible({ timeout: 60_000 });

  await page.evaluate(async () => {
    const appWindow = window as typeof window & {
      bankingGetState?: () => any;
      bankingRerender?: (tabKey?: string | null) => Promise<void>;
    };
    const state = appWindow.bankingGetState?.();
    if (!state?.pay?.draftWizard || typeof appWindow.bankingRerender !== 'function') {
      throw new Error('Banking Pay state is not available for the James post-resolution fixture');
    }

    const candidateId = '6e8493ae-c207-497e-8d83-0b518753f590';
    const timesheetId = '0ed36e08-3073-4dbc-a90b-f247dc3e62e4';
    const sessionId = '10000000-0000-4000-8000-000000000001';
    const caseResolutionIds = [
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    ];
    const resolutionIdentityKeys = [
      'DAY|11.500000|20.000000|40.000000',
      'NIGHT|1.500000|25.000000|45.000000'
    ];
    const clearPayload = {
      candidate_id: candidateId,
      timesheet_id: timesheetId,
      case_key: `timesheet:${timesheetId}`,
      resolution_family: 'BUCKETED',
      case_resolution_ids: caseResolutionIds,
      resolution_identity_keys: resolutionIdentityKeys
    };
    const shared = {
      line_type: 'TIMESHEET_PAYMENT',
      item_type: 'SEGMENT_DELTA',
      presentation_section: 'READY_TO_PAY',
      presentation_role: 'ALLOCATION',
      readiness_state: 'READY_TO_PAY',
      is_ready_for_draft: true,
      draftable: true,
      selected: true,
      selection_state: 'SELECTED',
      candidate_id: candidateId,
      timesheet_id: timesheetId,
      workbench_session_id: sessionId,
      workbench_session_version: 7,
      progress_counter_version: 11,
      display_name: 'CCR-03726 James Terwane',
      tms_ref: 'CCR-03726',
      client_name: 'West London Mental Health NHS Trust',
      week_ending_date: '2026-06-14',
      key_type: 'TS_DAY',
      key_value: '2026-06-08',
      pay_channel: 'UMBRELLA',
      paye_treatment: 'NONE'
    };
    const fixtures = [
      {
        ...shared,
        preview_row_id: '30000000-0000-4000-8000-000000000000',
        row_key: `timesheet:${timesheetId}:non_segment:total`,
        key_type: 'TS_TOTAL',
        key_value: 'TOTAL',
        presentation_role: 'PARENT',
        item_type: 'TIMESHEET_TOTAL',
        amount_ex_vat: 267.5,
        section_amount_ex_vat: 267.5,
        selected: false,
        selection_state: 'NOT_SELECTABLE',
        selection_allowed: false,
        draftable: false,
        is_ready_for_draft: false,
        is_excluded_from_allocation: true,
        resolved_segment_rows_replace_source_total: true,
        case_resolution_summary: {
          resolved_rate_candidate_id: candidateId,
          resolved_rate_timesheet_id: timesheetId,
          resolved_rate_case_key: `timesheet:${timesheetId}`,
          resolved_rate_family: 'BUCKETED',
          resolved_rate_component_count: 2,
          resolved_rate_clear_payload_json: clearPayload,
          case_resolution_ids: caseResolutionIds,
          resolution_identity_keys: resolutionIdentityKeys,
          has_resolved_rate: true,
          case_resolution_satisfied_now: true
        },
        section_segment_rows: [{
          segment_stable_key: `ts:${timesheetId}:99c9a88a`,
          timesheet_id: timesheetId,
          date: '2026-06-08',
          client_name: 'West London Mental Health NHS Trust',
          role: 'Registered Mental Health Nurse',
          band: 'Band 5',
          start_utc: '2026-06-08T07:00:00Z',
          end_utc: '2026-06-08T19:00:00Z',
          break_minutes: 30
        }]
      },
      {
        ...shared,
        preview_row_id: '30000000-0000-4000-8000-000000000001',
        row_key: `timesheet:${timesheetId}:segment:ts:${timesheetId}:99c9a88a:DAY`,
        amount_ex_vat: 230,
        section_amount_ex_vat: 230,
        source_pay_ex_vat: 230,
        source_rate: 20,
        target_rate: 40,
        target_pay_ex_vat: 230
      },
      {
        ...shared,
        preview_row_id: '30000000-0000-4000-8000-000000000002',
        row_key: `timesheet:${timesheetId}:segment:ts:${timesheetId}:99c9a88a:NIGHT`,
        amount_ex_vat: 37.5,
        section_amount_ex_vat: 37.5,
        source_pay_ex_vat: 37.5,
        source_rate: 25,
        target_rate: 45,
        target_pay_ex_vat: 37.5
      }
    ];

    const wizard = state.pay.draftWizard;
    const emptySections = {
      blocked_for_pay: [],
      blocked_for_pay_now: [],
      blocked_now: [],
      blocked_preview_lines: [],
      cases_resolutions: [],
      case_resolution_states: []
    };
    const fixtureCache = {
      ...emptySections,
      ready_to_pay_now: fixtures.slice(1),
      draftable_now: fixtures.slice(1),
      ready_preview_lines: fixtures.slice(1),
      canonical_preview_lines: fixtures.slice(1)
    };
    wizard.workbench = {
      session_id: sessionId,
      session_version: 7,
      progress_counter_version: 11,
      preview_pages: {},
      preview_page_cache: {},
      selected_preview_row_ids: fixtures.map((row) => row.preview_row_id),
      ...fixtureCache
    };
    wizard.decisions = {
      session_id: sessionId,
      session_version: 7,
      progress_counter_version: 11,
      selected_preview_row_ids: fixtures.map((row) => row.preview_row_id),
      ...fixtureCache
    };
    wizard.preview = {
      ...fixtureCache,
      preview_pages: {
        canonical_preview_lines: {
          section: 'canonical_preview_lines',
          rows: fixtures,
          items: fixtures
        }
      },
      preview_rows: fixtures.slice(1),
      rows: fixtures.slice(1),
      componentStateCache: { ...fixtureCache },
      component_state_cache: { ...fixtureCache },
      data: {
      preview_rows: fixtures.slice(1),
      rows: fixtures.slice(1),
      preview: {
        ...fixtureCache,
        preview_rows: fixtures.slice(1),
        rows: fixtures.slice(1),
        componentStateCache: { ...fixtureCache },
        component_state_cache: { ...fixtureCache }
      }
      }
    };
    wizard.ui_state = wizard.ui_state && typeof wizard.ui_state === 'object' ? wizard.ui_state : {};
    wizard.ui_state.ready_timesheet_breakdown_open_keys = [];
    await appWindow.bankingRerender(null);
  });

  const jamesRow = readyHost
    .locator('tr[data-timesheet-group-key][data-timesheet-id="0ed36e08-3073-4dbc-a90b-f247dc3e62e4"]')
    .filter({ hasText: 'James Terwane' })
    .first();
  await expect(jamesRow).toBeVisible({ timeout: 30_000 });
  await expect(jamesRow).toContainText('£267.50');
  await expect(jamesRow).toContainText('RESOLVED');

  const cancelResolvedRate = jamesRow.getByRole('button', { name: 'Cancel Resolved Rate', exact: true });
  await expect(cancelResolvedRate).toHaveCount(1);
  await expect(cancelResolvedRate).toBeEnabled();
  await expect(cancelResolvedRate).toHaveAttribute('data-candidate-id', '6e8493ae-c207-497e-8d83-0b518753f590');
  await expect(cancelResolvedRate).toHaveAttribute('data-timesheet-id', '0ed36e08-3073-4dbc-a90b-f247dc3e62e4');
  await expect(cancelResolvedRate).toHaveAttribute('data-resolution-family', 'BUCKETED');

  await jamesRow.getByRole('button', { name: /Show timesheet breakdown/ }).click();
  const breakdown = jamesRow.locator('xpath=following-sibling::tr[1]');
  await expect(breakdown).toBeVisible();
  await expect(breakdown).toContainText('08/06/2026');
  await expect(breakdown).toContainText('West London Mental Health NHS Trust');
  await expect(breakdown).toContainText('Registered Mental Health Nurse');
  await expect(breakdown).toContainText('Band 5');
  await expect(breakdown).toContainText('08:00');
  await expect(breakdown).toContainText('20:00');
  await expect(breakdown).toContainText('30 mins');
  await expect(breakdown).toContainText('Source pay: £230.00');
  await expect(breakdown).toContainText('Source rate: £20.00/hour');
  await expect(breakdown).toContainText('Target rate: £40.00/hour');
  await expect(breakdown).toContainText('Target pay: £230.00');
  await expect(breakdown).toContainText('Source pay: £37.50');
  await expect(breakdown).toContainText('Source rate: £25.00/hour');
  await expect(breakdown).toContainText('Target rate: £45.00/hour');
  await expect(breakdown).toContainText('Target pay: £37.50');

  const detailRows = breakdown.locator('tbody > tr');
  await expect(detailRows).toHaveCount(2);
  for (const detailRow of await detailRows.all()) {
    await expect(detailRow.locator('td').nth(2)).not.toHaveText('—');
    await expect(detailRow.locator('td').nth(3)).not.toHaveText('—');
    await expect(detailRow.locator('td').nth(4)).not.toHaveText('—');
    await expect(detailRow.locator('td').nth(7)).not.toHaveText('—');
  }

  await page.evaluate(async () => {
    const appWindow = window as typeof window & {
      bankingGetState?: () => any;
      bankingRerender?: (tabKey?: string | null) => Promise<void>;
    };
    const state = appWindow.bankingGetState?.();
    if (!state?.pay?.draftWizard || typeof appWindow.bankingRerender !== 'function') {
      throw new Error('Banking Pay state is not available for the recovery routing fixture');
    }
    const recovery = (name: string, rowId: string, section: string, amount: number, actionable: boolean) => ({
      preview_row_id: rowId,
      row_key: `recovery:${rowId}`,
      line_type: 'OVERPAYMENT_RECOVERY',
      item_type: 'OVERPAYMENT_RECOVERY',
      presentation_section: section,
      readiness_state: section,
      presentation_role: 'PARENT',
      candidate_id: rowId.replace(/^4/, '5'),
      finance_case_id: rowId.replace(/^4/, '6'),
      display_name: name,
      tms_ref: 'RECOVERY-TEST',
      client_name: 'Recovery browser test client',
      week_ending_date: '2026-06-14',
      pay_channel: 'PAYE',
      amount_ex_vat: amount,
      section_amount_ex_vat: amount,
      recoverable_this_pay_run_ex_vat: Math.abs(amount),
      outstanding_amount_ex_vat: -113.04,
      recoverable_amount_ex_vat: Math.abs(amount),
      case_components: [{
        component_key_type: 'TS_DAY',
        component_key_value: '2026-06-08',
        resolved_target_amount_ex_vat: -113.04,
        target_outstanding_ex_vat: -113.04,
        preview_due_amount_ex_vat: 0
      }],
      is_ready_for_draft: section === 'READY_TO_PAY',
      draftable: section === 'READY_TO_PAY',
      case_needs_resolution: section === 'CASES_RESOLUTIONS',
      selection_recovery_headroom_v1: {
        contract_version: 'PAY_WORKBENCH_SELECTION_RECOVERY_HEADROOM_V1',
        physical_section: 'BLOCKED_FOR_PAY',
        effective_section: section,
        recoverable_amount_ex_vat: Math.abs(amount),
        static_recovery_eligible: true,
        actionable_restructure_required: actionable,
        policy_x_authority_scope: 'PRE_DRAFT'
      }
    });
    const ready = recovery(
      'Positive Recovery Browser Fixture',
      '40000000-0000-4000-8000-000000000001',
      'READY_TO_PAY',
      -25,
      false
    );
    ready.section = 'canonical_preview_lines';
    ready.effective_section = 'canonical_preview_lines';
    ready.physical_section = 'blocked_for_pay';
    const staleReady = {
      ...ready,
      amount_ex_vat: 0,
      section_amount_ex_vat: 0,
      recoverable_this_pay_run_ex_vat: 0,
      recoverable_amount_ex_vat: 0
    } as any;
    delete staleReady.effective_section;
    delete staleReady.physical_section;
    const blocked = recovery(
      'Zero Non-Actionable Recovery Browser Fixture',
      '40000000-0000-4000-8000-000000000002',
      'BLOCKED_FOR_PAY',
      0,
      false
    );
    const cases = recovery(
      'Zero Actionable Recovery Browser Fixture',
      '40000000-0000-4000-8000-000000000003',
      'CASES_RESOLUTIONS',
      0,
      true
    );
    const empty = {
      ready_to_pay_now: [], draftable_now: [], ready_preview_lines: [], canonical_preview_lines: [],
      blocked_for_pay: [], blocked_for_pay_now: [], blocked_now: [], blocked_preview_lines: [],
      cases_resolutions: [], case_resolution_states: []
    };
    const cache = {
      ...empty,
      ready_to_pay_now: [staleReady],
      draftable_now: [staleReady],
      ready_preview_lines: [staleReady],
      canonical_preview_lines: [staleReady, blocked, cases],
      blocked_for_pay: [blocked],
      blocked_for_pay_now: [blocked],
      blocked_now: [blocked],
      blocked_preview_lines: [blocked],
      cases_resolutions: [cases],
      case_resolution_states: [cases]
    };
    const wizard = state.pay.draftWizard;
    const session = {
      session_id: '10000000-0000-4000-8000-000000000001',
      session_version: 7,
      progress_counter_version: 11
    };
    const canonicalPage = {
      ok: true,
      section: 'canonical_preview_lines',
      requested_section: 'ready_to_pay',
      resolved_section: 'canonical_preview_lines',
      rows: [ready],
      items: [ready]
    };
    wizard.workbench = {
      ...session,
      preview_pages: { canonical_preview_lines: canonicalPage },
      preview_page_cache: { canonical_preview_lines: canonicalPage },
      ...cache
    };
    wizard.decisions = { ...session, ...cache };
    wizard.preview = {
      ...cache,
      preview_rows: [ready, blocked, cases],
      rows: [ready, blocked, cases],
      componentStateCache: { ...cache },
      component_state_cache: { ...cache },
      data: {
        preview_rows: [ready, blocked, cases],
        rows: [ready, blocked, cases],
        preview: {
          ...cache,
          preview_rows: [ready, blocked, cases],
          rows: [ready, blocked, cases],
          componentStateCache: { ...cache },
          component_state_cache: { ...cache }
        }
      }
    };
    await appWindow.bankingRerender(null);
  });

  const casesHost = page.locator('#bankingPayCasesScrollHost');
  const blockedHost = page.locator('#bankingPayBlockedScrollHost');
  await expect(readyHost).toContainText('Positive Recovery Browser Fixture');
  const positiveRecoveryRows = readyHost.locator('tr').filter({ hasText: 'Positive Recovery Browser Fixture' });
  await expect(positiveRecoveryRows).toHaveCount(1);
  await expect(positiveRecoveryRows).toContainText('£25.00');
  await expect(positiveRecoveryRows).not.toContainText('£0.00');
  await positiveRecoveryRows.getByRole('button', { name: 'Show line breakdown' }).click();
  await expect(readyHost).toContainText('Recoverable this pay run');
  await expect(readyHost).toContainText('25.00');
  await expect(readyHost).not.toContainText('Zero Non-Actionable Recovery Browser Fixture');
  await expect(readyHost).not.toContainText('Zero Actionable Recovery Browser Fixture');
  await expect(blockedHost).toContainText('Zero Non-Actionable Recovery Browser Fixture');
  await expect(blockedHost).not.toContainText('Zero Actionable Recovery Browser Fixture');
  await expect(casesHost).toContainText('Zero Actionable Recovery Browser Fixture');
  await expect(casesHost).not.toContainText('Zero Non-Actionable Recovery Browser Fixture');

  expect(interceptedIndex).toBeGreaterThan(0);
  expect(interceptedMain).toBeGreaterThan(0);
  expect(prohibitedMutationRequests).toEqual([]);
  expect(unexpectedProductionRequests).toEqual([]);
});
