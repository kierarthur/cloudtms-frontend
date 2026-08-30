import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

test('opens timesheet breakdowns without flashing the Ready list back to the top', async ({ page }) => {
  test.setTimeout(120_000);

  const localMainPath = resolve(__dirname, '../../js/main.js');
  let interceptedMainUrl = '';
  const unexpectedProductionBackendRequests: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
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
        'x-codex-local-asset': 'banking-pay-timesheet-breakdown-scroll'
      }
    });
  });

  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(new URL(interceptedMainUrl).pathname).toBe('/js/main.js');

  await page.getByRole('button', { name: 'Banking', exact: true }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  const readyHost = page.locator('#bankingPayReadyScrollHost');
  await expect(readyHost).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#bankingPayPreviewProgress[data-progress-active="false"]')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(750);

  // The original live CCR-00835 row is now correctly reserved by its draft and
  // therefore cannot remain in Ready to Pay. Mount a deterministic UI-only set
  // of ready timesheets so the scroll-restoration behaviour remains testable
  // without cancelling or altering a real payment batch.
  await page.evaluate(async () => {
    const appWindow = window as typeof window & {
      bankingGetState?: () => any;
      bankingRerender?: (tabKey?: string | null) => Promise<void>;
    };
    const state = appWindow.bankingGetState?.();
    if (!state?.pay?.draftWizard || typeof appWindow.bankingRerender !== 'function') {
      throw new Error('Banking Pay state is not available for the scroll fixture');
    }

    const fixtures = Array.from({ length: 14 }, (_, index) => {
      const serial = String(index + 1).padStart(12, '0');
      const day = String(index + 1).padStart(2, '0');
      const previewRowId = `10000000-0000-4000-8000-${serial}`;
      const timesheetId = `20000000-0000-4000-8000-${serial}`;
      const workDate = `2026-06-${day}`;
      return {
        preview_row_id: previewRowId,
        row_key: `CODEX_SCROLL_FIXTURE_${index + 1}`,
        line_type: 'TIMESHEET_PAYMENT',
        item_type: 'SEGMENT_DELTA',
        presentation_section: 'READY_TO_PAY',
        presentation_role: 'PARENT',
        readiness_state: 'READY_TO_PAY',
        is_ready_for_draft: true,
        draftable: true,
        selected: true,
        selection_state: 'SELECTED',
        candidate_id: '30000000-0000-4000-8000-000000000001',
        timesheet_id: timesheetId,
        display_name: 'Codex Scroll Fixture',
        tms_ref: 'TEST-SCROLL',
        client_name: `Browser test client ${index + 1}`,
        week_ending_date: '2026-06-14',
        work_date: workDate,
        key_type: 'TS_DAY',
        key_value: workDate,
        pay_channel: 'PAYE',
        paye_treatment: 'GROSS_ADD',
        amount_ex_vat: index + 1,
        section_amount_ex_vat: index + 1,
        segment_rows: [{
          segment_id: `40000000-0000-4000-8000-${serial}`,
          timesheet_id: timesheetId,
          date: workDate,
          client_name: `Browser test client ${index + 1}`,
          role: 'Browser regression role',
          band: 'Test',
          start: '09:00',
          finish: '17:00',
          break_minutes: 30,
          pay_amount_ex_vat: index + 1
        }]
      };
    });

    const wizard = state.pay.draftWizard;
    wizard.workbench = wizard.workbench && typeof wizard.workbench === 'object' ? wizard.workbench : {};
    wizard.workbench.ready_preview_lines = fixtures;
    wizard.workbench.canonical_preview_lines = fixtures;
    wizard.ui_state = wizard.ui_state && typeof wizard.ui_state === 'object' ? wizard.ui_state : {};
    wizard.ui_state.ready_timesheet_breakdown_open_keys = [];
    await appWindow.bankingRerender(null);
  });

  const targetRow = readyHost
    .locator('tr[data-timesheet-group-key][data-candidate-id]')
    .filter({ hasText: 'Codex Scroll Fixture' })
    .filter({ has: page.locator('[data-action="banking:pay:toggleTimesheetBreakdown"]') })
    .nth(7);
  const toggle = targetRow.getByRole('button', { name: /Show timesheet breakdown/ });

  await expect(targetRow).toBeVisible({ timeout: 60_000 });
  await expect(toggle).toBeVisible();

  const targetIdentity = await targetRow.evaluate((row) => ({
    groupKey: row.getAttribute('data-timesheet-group-key'),
    candidateId: row.getAttribute('data-candidate-id')
  }));
  expect(targetIdentity.groupKey).toBeTruthy();
  expect(targetIdentity.candidateId).toBeTruthy();

  const captureToggleTrace = () => page.evaluate(async (identity) => {
    const findRow = () => Array.from(document.querySelectorAll<HTMLElement>('#bankingPayReadyScrollHost tr[data-timesheet-group-key][data-candidate-id]'))
      .find((row) => row.getAttribute('data-timesheet-group-key') === identity.groupKey
        && row.getAttribute('data-candidate-id') === identity.candidateId);
    const samples: Array<{ scrollTop: number | null; rowTop: number | null; expanded: string | null }> = [];
    return await new Promise<typeof samples>((resolveTrace) => {
      const sample = () => {
        const host = document.querySelector<HTMLElement>('#bankingPayReadyScrollHost');
        const row = findRow();
        const button = row?.querySelector<HTMLElement>('[data-action="banking:pay:toggleTimesheetBreakdown"]');
        samples.push({
          scrollTop: host ? Math.round(host.scrollTop) : null,
          rowTop: row ? Math.round(row.getBoundingClientRect().top) : null,
          expanded: button?.getAttribute('aria-expanded') || null
        });
        if (samples.length >= 160) {
          resolveTrace(samples);
          return;
        }
        setTimeout(sample, 5);
      };
      setTimeout(sample, 0);
    });
  }, targetIdentity);

  await targetRow.evaluate((row) => {
    const host = row.closest('#bankingPayReadyScrollHost');
    if (!(host instanceof HTMLElement)) throw new Error('Ready scroll host not found');
    const hostRect = host.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    host.scrollTop += (rowRect.top - hostRect.top) - 75;
  });

  const initial = await targetRow.evaluate((row) => {
    const host = row.closest('#bankingPayReadyScrollHost');
    if (!(host instanceof HTMLElement)) throw new Error('Ready scroll host not found');
    return {
      scrollTop: Math.round(host.scrollTop),
      rowTop: Math.round(row.getBoundingClientRect().top)
    };
  });
  expect(initial.scrollTop).toBeGreaterThan(0);

  const tracePromise = captureToggleTrace();

  await toggle.click();
  const trace = await tracePromise;
  await expect(targetRow.getByRole('button', { name: /Hide timesheet breakdown/ })).toBeVisible();

  const expandedSamples = trace.filter((sample) => sample.expanded === 'true');
  const expandedRowTops = Array.from(new Set(expandedSamples.map((sample) => sample.rowTop)));
  expect(expandedSamples.length).toBeGreaterThan(0);
  expect(expandedSamples.every((sample) => sample.scrollTop === initial.scrollTop)).toBe(true);
  expect(expandedRowTops).toEqual([initial.rowTop]);

  await targetRow.getByRole('button', { name: /Hide timesheet breakdown/ }).click();
  await expect(toggle).toBeVisible();
  await readyHost.evaluate((host) => { host.scrollTop = 0; });

  const unscrolledInitial = await targetRow.evaluate((row) => ({
    scrollTop: Math.round((row.closest('#bankingPayReadyScrollHost') as HTMLElement).scrollTop),
    rowTop: Math.round(row.getBoundingClientRect().top)
  }));
  expect(unscrolledInitial.scrollTop).toBe(0);

  const unscrolledTracePromise = captureToggleTrace();
  await toggle.evaluate((button) => (button as HTMLElement).click());
  const unscrolledTrace = await unscrolledTracePromise;
  await expect(targetRow.getByRole('button', { name: /Hide timesheet breakdown/ })).toBeVisible();

  const unscrolledExpandedSamples = unscrolledTrace.filter((sample) => sample.expanded === 'true');
  expect(unscrolledExpandedSamples.length).toBeGreaterThan(0);
  expect(unscrolledExpandedSamples.every((sample) => sample.scrollTop === 0)).toBe(true);
  expect(Array.from(new Set(unscrolledExpandedSamples.map((sample) => sample.rowTop)))).toEqual([unscrolledInitial.rowTop]);
  expect(unexpectedProductionBackendRequests).toEqual([]);
});

test('shows canonical correction date and correction-specific actions in a Ready timesheet breakdown', async ({ page }) => {
  test.setTimeout(120_000);

  const localMainPath = resolve(__dirname, '../../js/main.js');
  let interceptedMainUrl = '';
  const unexpectedProductionBackendRequests: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
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
        'x-codex-local-asset': 'banking-pay-correction-carrier-presentation'
      }
    });
  });

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
  expect(new URL(interceptedMainUrl).pathname).toBe('/js/main.js');

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
      throw new Error('Banking Pay state is not available for the correction carrier fixture');
    }

    const previewRowId = '50000000-0000-4000-8000-000000000001';
    const timesheetId = '60000000-0000-4000-8000-000000000001';
    const fixture = {
      preview_row_id: previewRowId,
      row_key: 'correction-chain:70000000-0000-4000-8000-000000000001:ts_day:2026-06-30',
      line_type: 'TIMESHEET_PAYMENT',
      item_type: 'SEGMENT_DELTA',
      presentation_section: 'READY_TO_PAY',
      presentation_role: 'PARENT',
      readiness_state: 'READY_TO_PAY',
      is_ready_for_draft: true,
      draftable: true,
      selected: true,
      selection_state: 'SELECTED',
      candidate_id: '80000000-0000-4000-8000-000000000001',
      timesheet_id: timesheetId,
      display_name: 'Correction Carrier Browser Fixture',
      tms_ref: 'CCR-TEST',
      client_name: 'Browser test client',
      role: 'CPN',
      band: '6',
      week_ending_date: '2026-07-05',
      key_type: 'TS_DAY',
      key_value: '2026-06-30',
      pay_channel: 'UMBRELLA',
      paye_treatment: 'NONE',
      amount_ex_vat: 130,
      section_amount_ex_vat: 130,
      has_resolved_rate: true
    };

    const wizard = state.pay.draftWizard;
    wizard.workbench = wizard.workbench && typeof wizard.workbench === 'object' ? wizard.workbench : {};
    wizard.workbench.ready_preview_lines = [fixture];
    wizard.workbench.canonical_preview_lines = [fixture];
    wizard.ui_state = wizard.ui_state && typeof wizard.ui_state === 'object' ? wizard.ui_state : {};
    wizard.ui_state.ready_timesheet_breakdown_open_keys = [];
    await appWindow.bankingRerender(null);
  });

  const parentRow = readyHost
    .locator('tr[data-timesheet-group-key][data-candidate-id]')
    .filter({ hasText: 'Correction Carrier Browser Fixture' })
    .filter({ has: page.locator('[data-action="banking:pay:toggleTimesheetBreakdown"]') })
    .first();
  await expect(parentRow).toBeVisible({ timeout: 60_000 });
  await parentRow.getByRole('button', { name: /Show timesheet breakdown/ }).click();

  const breakdownRow = readyHost
    .locator('tr[data-preview-row-id="50000000-0000-4000-8000-000000000001"]')
    .filter({ hasText: 'Correction' })
    .last();
  await expect(breakdownRow).toContainText('30/06/2026');
  await expect(breakdownRow).toContainText('Correction date');
  await expect(breakdownRow).toContainText('Correction');
  await expect(breakdownRow.getByRole('button', { name: 'Snooze correction' })).toBeVisible();
  await expect(breakdownRow).not.toContainText('Snooze segment');
  expect(unexpectedProductionBackendRequests).toEqual([]);
});
