import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

test('shows each zero-headroom recovery once in Blocked and preserves its constituent breakdown', async ({ page }) => {
  test.setTimeout(120_000);

  const localMainPath = resolve(__dirname, '../../js/main.js');
  const normalTestBackendRequests: Array<{ at: number; method: string; pathname: string }> = [];
  const unexpectedProductionBackendRequests: string[] = [];
  let interceptedMainUrl = '';

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://test-cloudtms-backend.kier-88a.workers.dev/')) {
      normalTestBackendRequests.push({
        at: Date.now(),
        method: request.method(),
        pathname: new URL(url).pathname
      });
    }
    if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) unexpectedProductionBackendRequests.push(url);
  });

  await page.route('**/js/main.js*', async (route) => {
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
        'x-codex-local-asset': 'banking-overpayment-presentation'
      }
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(new URL(interceptedMainUrl).pathname).toBe('/js/main.js');

  await page.getByRole('button', { name: 'Banking', exact: true }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  const bankingModal = page.locator('#modal');
  await expect(bankingModal).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#bankingPayPreviewProgress[data-progress-active="false"]')).toBeVisible({ timeout: 60_000 });

  await page.evaluate(async () => {
    const appWindow = window as typeof window & {
      bankingGetState?: () => any;
      bankingRerender?: (tabKey?: string | null) => Promise<void>;
    };
    const state = appWindow.bankingGetState?.();
    if (!state?.pay?.draftWizard || typeof appWindow.bankingRerender !== 'function') {
      throw new Error('Banking Pay state is not available for the zero-headroom recovery fixture');
    }
    const makeRecovery = (rowId: string, caseId: string, date: string, components: any[]) => ({
      preview_row_id: rowId,
      row_key: `zero-recovery:${caseId}`,
      line_type: 'OVERPAYMENT_RECOVERY',
      item_type: 'OVERPAYMENT_RECOVERY',
      presentation_section: 'BLOCKED_FOR_PAY',
      readiness_state: 'BLOCKED_FOR_PAY',
      presentation_role: 'PARENT',
      presentation_reason: 'NO_PAY_HEADROOM',
      blocked_reason_codes: ['NO_PAY_HEADROOM'],
      candidate_id: '70000000-0000-4000-8000-000000000001',
      finance_case_id: caseId,
      display_name: 'Zero Recovery Browser Fixture',
      tms_ref: 'RECOVERY-FIXTURE',
      client_name: 'Recovery browser test client',
      week_ending_date: date,
      pay_channel: 'PAYE',
      amount_ex_vat: '0.00',
      section_amount_ex_vat: '0.00',
      recoverable_amount_ex_vat: '0.00',
      is_ready_for_draft: false,
      draftable: false,
      case_components: components,
      selection_recovery_headroom_v1: {
        contract_version: 'PAY_WORKBENCH_SELECTION_RECOVERY_HEADROOM_V1',
        physical_section: 'BLOCKED_FOR_PAY',
        effective_section: 'BLOCKED_FOR_PAY',
        recoverable_amount_ex_vat: '0.00',
        static_recovery_eligible: true,
        actionable_restructure_required: false,
        policy_x_authority_scope: 'PRE_DRAFT'
      }
    });
    const currentComponents = ['06', '07', '08', '09', '10'].map((day, index) => ({
      finance_component_id: `71000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      component_key_type: 'TS_DAY',
      component_key_value: `2026-07-${day}`,
      source_amount: '11.25',
      remaining_source_amount: '11.25',
      preview_due_amount_ex_vat: '0.00'
    }));
    const olderComponents = [
      ['ACCOMMODATION', '2.00'],
      ['TRAVEL', '11.99'],
      ['2026-06-09', '0.98'],
      ['2026-06-10', '0.87']
    ].map(([value, amount], index) => ({
      finance_component_id: `72000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      component_key_type: value.includes('-') ? 'TS_DAY' : 'EXPENSE_CODE',
      component_key_value: value,
      source_amount: amount,
      remaining_source_amount: amount,
      preview_due_amount_ex_vat: '0.00'
    }));
    const blocked = [
      makeRecovery('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', '2026-07-12', currentComponents),
      makeRecovery('73000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', '2026-06-14', olderComponents)
    ];
    const cache = {
      ready_to_pay_now: [], draftable_now: [], ready_preview_lines: [],
      blocked_for_pay: blocked, blocked_for_pay_now: blocked, blocked_now: blocked, blocked_preview_lines: blocked,
      cases_resolutions: [], case_resolution_states: [], canonical_preview_lines: blocked
    };
    const session = {
      session_id: '75000000-0000-4000-8000-000000000001',
      session_version: 1,
      progress_counter_version: 1
    };
    const progress = {
      ...session,
      status: 'READY',
      session_ready: true,
      ready_for_draft: true,
      candidate_counts: {
        total: 1, ready: 1, pending: 0, processing: 0, materialisation_pending: 0,
        dirty: 0, failed: 0, unknown: 0, unseeded: 0
      },
      line_counts: { total: 2, complete: 2, pending: 0, ready_not_materialised: 0, failed: 0, unknown: 0 },
      job_counts: { queued: 0, running: 0, active: 0, unresolved_failed: 0, unresolved_dead: 0 },
      selected_eligible_ready_row_count: 0
    };
    const wizard = state.pay.draftWizard;
    wizard.workbench = { ...session, progress, preview_pages: {}, preview_page_cache: {}, ...cache };
    wizard.decisions = { ...session, progress, ...cache };
    wizard.preview = {
      ...cache,
      preview_rows: blocked,
      rows: blocked,
      componentStateCache: { ...cache },
      component_state_cache: { ...cache },
      data: {
        preview_rows: blocked,
        rows: blocked,
        preview: {
          ...cache,
          preview_rows: blocked,
          rows: blocked,
          componentStateCache: { ...cache },
          component_state_cache: { ...cache }
        }
      }
    };
    await appWindow.bankingRerender(null);
  });

  const readyCard = bankingModal.locator('.card').filter({ hasText: 'Ready to Pay' }).first();
  await expect(readyCard).toContainText('Ready to Pay 0 candidate(s) 0 line(s) Amount 0.00');

  const recoveryRows = bankingModal.locator('tr').filter({ hasText: 'RECOVERY-FIXTURE' });
  await expect(recoveryRows).toHaveCount(2);

  const recoveryRow = recoveryRows.filter({ hasText: '12/07/2026' });
  await expect(recoveryRow).toHaveCount(1);
  await expect(recoveryRow).toBeVisible();
  await expect(recoveryRow).toContainText('OVERPAYMENT RECOVERY');
  await expect(recoveryRow).toContainText('No available funds to recover this yet.');
  await expect(recoveryRow).toContainText('56.25');
  await expect(recoveryRow).toContainText('No recovery can be made because there are no available funds to deduct from this pay run.');
  await expect(recoveryRow).toContainText('Insufficient funds');
  await expect(recoveryRow).not.toContainText('Blocked for pay');
  await expect(recoveryRow).not.toContainText('Ready to pay');
  await expect(recoveryRow).not.toContainText('Timesheet pay — 06/07/2026');
  await expect(bankingModal.getByText(/^Blocked amount -?\d+\.\d{2}$/, { exact: true })).toBeVisible();

  const olderRecoveryRow = recoveryRows.filter({ hasText: '14/06/2026' });
  await expect(olderRecoveryRow).toHaveCount(1);
  await expect(olderRecoveryRow).toContainText('15.84');
  await expect(olderRecoveryRow).toContainText('No recovery can be made because there are no available funds to deduct from this pay run.');
  await expect(olderRecoveryRow).toContainText('Insufficient funds');

  const detailRow = recoveryRow.locator('xpath=following-sibling::tr[1]');
  const breakdown = detailRow.locator('details[data-overpayment-recovery-breakdown]');
  await expect(breakdown.getByText('Show overpayment breakdown', { exact: true })).toBeVisible();
  await breakdown.locator('summary').click();
  await expect(breakdown).toContainText('This overpayment is made up of the following amounts.');
  await expect(breakdown.locator('thead')).toContainText('Description');
  await expect(breakdown.locator('thead')).toContainText('Original overpayment');
  await expect(breakdown.locator('thead')).toContainText('Outstanding');
  await expect(breakdown.locator('thead')).toContainText('Recoverable this pay run');

  const componentRows = breakdown.locator('tbody tr');
  await expect(componentRows).toHaveCount(5);
  for (const [index, date] of ['06/07/2026', '07/07/2026', '08/07/2026', '09/07/2026', '10/07/2026'].entries()) {
    await expect(componentRows.nth(index)).toContainText(`Timesheet pay — ${date}`);
    await expect(componentRows.nth(index)).toContainText('-11.25');
    await expect(componentRows.nth(index)).toContainText('0.00');
  }
  await expect(breakdown.locator('tfoot')).toContainText('Total outstanding recovery');
  await expect(breakdown.locator('tfoot')).toContainText('-56.25');
  await expect(breakdown.locator('tfoot')).toContainText('0.00');

  expect(normalTestBackendRequests.length).toBeGreaterThan(0);
  expect(unexpectedProductionBackendRequests).toEqual([]);
});
