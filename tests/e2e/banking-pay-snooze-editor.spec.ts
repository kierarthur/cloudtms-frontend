import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

test('keeps the mobile Snooze editor concise, saveable and free of native discard dialogs', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 412, height: 915 });

  const localMainPath = resolve(__dirname, '../../js/main.js');
  const localModalCssPath = resolve(__dirname, '../../css/modal-modernisation.css');
  const validationPayloads: any[] = [];
  const upsertPayloads: any[] = [];
  const nativeDialogs: string[] = [];

  page.on('dialog', async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.route('**/js/main.js*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'testmode.arthur-rai.co.uk' && url.pathname === '/js/main.js') {
      await route.fulfill({ path: localMainPath, contentType: 'application/javascript; charset=utf-8' });
      return;
    }
    await route.continue();
  });
  await page.route('**/css/modal-modernisation.css*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'testmode.arthur-rai.co.uk' && url.pathname === '/css/modal-modernisation.css') {
      await route.fulfill({ path: localModalCssPath, contentType: 'text/css; charset=utf-8' });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/banking/pay/snooze/validate', async (route) => {
    validationPayloads.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        london_current_date: '2026-08-30',
        next_official_pay_date: '2026-09-04',
        date_context_configuration_fingerprint: 'fixture-date-context',
        warning_required: false
      })
    });
  });
  await page.route('**/api/banking/pay/snooze/upsert', async (route) => {
    const payload = route.request().postDataJSON();
    upsertPayloads.push(payload);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        snooze_id: '55555555-5555-4555-8555-555555555555',
        candidate_id: payload.candidate_id,
        snooze_mode: payload.snooze_until_date ? 'DATED' : 'INDEFINITE',
        snooze_until_date: payload.snooze_until_date,
        note: payload.note,
        should_remain_visible_in_live_pay_workbench: !!payload.snooze_until_date,
        live_pay_bucket: payload.snooze_until_date ? 'BLOCKED_FOR_PAY' : 'LOANS_SNOOZES_ONLY'
      })
    });
  });
  await page.route('**/api/banking/finance/loans-snoozes**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, summary: {}, finance_cases: [], timesheet_snoozes: [], pagination: {} })
    });
  });

  await page.goto('https://testmode.arthur-rai.co.uk/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Banking', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Banking Pay', exact: true }).click();
  const parentBankingModal = page.locator('#modal');
  await expect(parentBankingModal).toBeVisible({ timeout: 30_000 });
  await expect(parentBankingModal).toContainText('Ready to Pay', { timeout: 60_000 });
  await page.evaluate(() => {
    const state = (window as any).bankingGetState?.();
    const wizard = state?.pay?.draftWizard;
    if (!wizard) return;
    wizard.pay_date = '';
    if (wizard.workbench && typeof wizard.workbench === 'object') {
      wizard.workbench.session_id = null;
      wizard.workbench.sessionId = null;
    }
  });

  const seed = {
    candidate_id: '11111111-1111-4111-8111-111111111111',
    client_name: 'Arthur Rai Medical Services',
    role: 'CPN',
    band: 'Band 6',
    timesheet_id: '22222222-2222-4222-8222-222222222222',
    booking_id: '44444444-4444-4444-8444-444444444444',
    segment_id: '33333333-3333-4333-8333-333333333333',
    segment_stable_key: '2026-07-03|09:00|17:00',
    snooze_kind: 'DO_NOT_PAY',
    snooze_scope_kind: 'SEGMENT',
    subject_label: 'Segment — Baljit Rai-Baptiste — 03/07/2026 — 09:00-17:00'
  };

  await page.evaluate(async (modalSeed) => {
    await (window as any).openBankingFinanceSnoozeModal(modalSeed);
  }, seed);

  const modal = page.locator('#modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#modalTitle')).toContainText('Snooze payment');
  await expect(modal).toContainText('Shift payment');
  await expect(modal).toContainText('03/07/2026 • 09:00-17:00');
  await expect(modal).toContainText('Baljit Rai-Baptiste • Arthur Rai Medical Services');
  await expect(modal).toContainText('Role CPN • Band 6');
  await expect(modal).not.toContainText('Band Band 6');
  await expect(modal).not.toContainText('Specific segment');
  await expect(modal).not.toContainText('Segment payment');
  await expect(modal).not.toContainText(seed.timesheet_id);
  await expect(modal).not.toContainText(seed.booking_id);
  await expect(modal).not.toContainText(seed.segment_id);
  await expect(modal).not.toContainText(seed.segment_stable_key);

  const applyButton = modal.getByRole('button', { name: 'Apply Snooze', exact: true });
  await expect(applyButton).toBeVisible();
  const applyBox = await applyButton.boundingBox();
  expect(applyBox).not.toBeNull();
  expect((applyBox?.y || 0) + (applyBox?.height || 0)).toBeLessThanOrEqual(915);

  await modal.getByRole('checkbox', { name: 'Keep this excluded until manually unsnoozed' }).check();
  await modal.getByRole('textbox', { name: 'Note / reason' }).fill('Mobile Snooze fixture');
  await modal.getByRole('button', { name: 'Discard', exact: true }).click();
  const discardDialog = page.getByRole('dialog', { name: 'Discard changes?' });
  await expect(discardDialog).toBeVisible();
  await expect(discardDialog).toContainText('Your unsaved edits will be lost.');
  await discardDialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(modal.locator('#modalTitle')).toContainText('Snooze payment');
  expect(nativeDialogs).toEqual([]);

  await applyButton.click();
  await expect.poll(() => upsertPayloads.length, { timeout: 15_000 }).toBe(1);
  expect(validationPayloads.map((payload) => payload.validation_phase)).toEqual(['PRE_OPEN', 'PRE_SAVE']);
  expect(upsertPayloads[0]).toMatchObject({
    candidate_id: seed.candidate_id,
    timesheet_id: seed.timesheet_id,
    booking_id: seed.booking_id,
    segment_id: seed.segment_id,
    segment_stable_key: seed.segment_stable_key,
    snooze_kind: 'DO_NOT_PAY',
    snooze_until_date: null,
    note: 'Mobile Snooze fixture'
  });
  expect(nativeDialogs).toEqual([]);
});
