import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const origin = 'https://testmode.arthur-rai.co.uk';
const localIndex = readFileSync(resolve(root, 'index.html'), 'utf8');
const localMain = readFileSync(resolve(root, 'js/main.js'), 'utf8');
const localModalCss = readFileSync(resolve(root, 'css/modal-modernisation.css'), 'utf8');
const localAuthorisers = readFileSync(resolve(root, 'js/manager-authorisers.js'), 'utf8');
const marker = `contract-workflow:${createHash('sha256').update(localMain).digest('hex').slice(0, 12)}`;
const artifactDir = resolve(root, '.codex-tmp/contract-workflow-visual');

test.use({
  serviceWorkers: 'block',
  storageState: process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json'
});

const devices = [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'ipad', width: 820, height: 1180 },
  { label: 'large-phone', width: 480, height: 1040 },
  { label: 'phone', width: 390, height: 844 }
];

async function installLocalAssets(page: Page) {
  const counts = { index: 0, main: 0, css: 0, authorisers: 0 };
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      counts.index += 1;
      return route.fulfill({
        body: localIndex.replace('</head>', `<script>window.__CONTRACT_WORKFLOW_LOCAL_PROOF=${JSON.stringify(marker)};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
    }
    if (url.pathname === '/js/main.js') {
      counts.main += 1;
      return route.fulfill({ body: localMain, contentType: 'application/javascript; charset=utf-8', headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker } });
    }
    if (url.pathname === '/css/modal-modernisation.css') {
      counts.css += 1;
      return route.fulfill({ body: localModalCss, contentType: 'text/css; charset=utf-8', headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker } });
    }
    if (url.pathname === '/js/manager-authorisers.js') {
      counts.authorisers += 1;
      return route.fulfill({ body: localAuthorisers, contentType: 'application/javascript; charset=utf-8', headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker } });
    }
    return route.continue();
  });

  await page.route('**/api/search/candidates**', (route) => route.fulfill({
    json: {
      items: [
        { id: 'b0000000-0000-4000-8000-000000000001', first_name: 'Amira', last_name: 'Begum', primary_job_title: 'Community Psychiatric Nurse', city: 'Reading' },
        { id: 'b0000000-0000-4000-8000-000000000002', first_name: 'Daniel', last_name: 'Clarke', primary_job_title: 'Registered Mental Health Nurse', city: 'Bracknell' },
        { id: 'b0000000-0000-4000-8000-000000000003', first_name: 'Leila', last_name: 'Morgan', primary_job_title: 'Health Visitor', city: 'Slough' }
      ]
    }
  }));
  return counts;
}

async function openApp(page: Page) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__CONTRACT_WORKFLOW_LOCAL_PROOF)).toBe(marker);
}

async function openMockContract(page: Page, overrides: Record<string, unknown> = {}, openMode: 'view' | 'edit' = 'view') {
  await page.evaluate(({ contractOverrides, requestedMode }) => {
    const contract = {
      id: 'a0000000-0000-4000-8000-000000000001',
      updated_at: '2026-08-27T08:00:00.000Z',
      candidate_id: 'a0000000-0000-4000-8000-000000000002',
      candidate_display: 'Baljit Rai-Baptiste',
      client_id: 'a0000000-0000-4000-8000-000000000003',
      client_name: 'Arthur Rai Medical Services',
      role: 'Community Psychiatric Nurse',
      band: 'Band 6',
      display_site: 'Arthur Rai Medical Services',
      start_date: '2026-09-07',
      end_date: '2026-11-29',
      week_ending_weekday_snapshot: 0,
      pay_method_snapshot: 'PAYE',
      overrideclientsettings: false,
      candidate_paper_submission_enabled_override: null,
      timesheet_break_entry_mode: null,
      real_timesheets_count: 0,
      protected_timesheet_count: 0,
      std_schedule_json: {
        mon: { start: '09:00', end: '17:00', break_minutes: 30 },
        tue: { start: '09:00', end: '17:00', break_minutes: 30 },
        wed: { start: '09:00', end: '17:00', break_minutes: 30 },
        thu: { start: '09:00', end: '17:00', break_minutes: 30 },
        fri: { start: '09:00', end: '17:00', break_minutes: 30 }
      },
      rates_json: { paye_day: 20, paye_night: 25, paye_sat: 25, paye_sun: 30, paye_bh: 30, charge_day: 30, charge_night: 35, charge_sat: 35, charge_sun: 40, charge_bh: 40 },
      ...contractOverrides
    };
    (window as any).modalCtx = {
      entity: 'contracts',
      mode: requestedMode,
      data: contract,
      formState: { __forId: contract.id, main: {}, pay: {} },
      client_settings_snapshot: {
        default_submission_mode: 'ELECTRONIC',
        candidate_paper_submission_enabled: true,
        timesheet_break_entry_mode: 'DURATION_MINUTES',
        is_nhsp: false,
        autoprocess_hr: false,
        no_timesheet_required: false,
        daily_calc_of_invoices: true,
        self_bill_no_invoices_sent: false
      },
      client_settings_snapshot_client_id: contract.client_id
    };
    (window as any).showModal(
      requestedMode === 'edit' ? 'Edit Contract' : 'View Contract',
      [
        { key: 'main', label: 'Main', title: 'Main' },
        { key: 'rates', label: 'Rates', title: 'Rates' },
        { key: 'extras', label: 'Additional Rates', title: 'Additional Rates' }
      ],
      (key: string) => {
        const ctx = (window as any).modalCtx;
        if (key === 'rates') return (window as any).renderContractRatesTab(ctx);
        if (key === 'extras') return (window as any).renderContractAdditionalRatesTab(ctx);
        return (window as any).renderContractMainTab(ctx);
      },
      async () => true,
      true,
      null,
      {
        kind: 'contracts',
        frameEntity: 'contracts',
        forceEdit: requestedMode === 'edit',
        forceView: requestedMode === 'view',
        primaryLabel: 'Save'
      }
    );
  }, { contractOverrides: overrides, requestedMode: openMode });
  await expect(page.locator('#modalTitle')).toContainText(openMode === 'edit' ? 'Edit Contract' : 'View Contract');
}

async function assertProtectedContractControls(page: Page) {
  await expect(page.locator('#contractModalTitleLock')).toBeVisible();
  await expect(page.locator('.ctms-contract-main .ctms-contract-lock-banner')).toHaveCount(0);
  await expect(page.locator('#candidate_name_display')).not.toBeEditable();
  await expect(page.locator('#client_name_display')).not.toBeEditable();
  await expect(page.locator('#btnPickCandidate')).toBeDisabled();
  await expect(page.locator('#btnClearCandidate')).toBeDisabled();
  await expect(page.locator('#btnPickClient')).toBeDisabled();
  await expect(page.locator('#btnClearClient')).toBeDisabled();
  await expect(page.locator('input[name="role"]')).not.toBeEditable();
  await expect(page.locator('input[name="band"]')).not.toBeEditable();
  await expect(page.locator('select[name="pay_method_snapshot"]')).toBeDisabled();

  // These are deliberately safe future-window/display controls and must not be
  // swallowed by the core-authority lock.
  await expect(page.locator('input[name="display_site"]')).toBeEnabled();
  await expect(page.locator('input[name="start_date"]')).toBeEnabled();
  await expect(page.locator('input[name="end_date"]')).toBeEnabled();
  await expect(page.locator('input[name="is_ad_hoc"]')).toBeEnabled();

  await page.getByRole('button', { name: 'Contract settings', exact: true }).click();
  await expect(page.locator('#modalTitle')).toContainText('Contract settings');
  await expect(page.locator('#contractModalTitleLock')).toBeVisible();
  await expect(page.locator('input[name="overrideclientsettings"]')).toBeDisabled();
  const lockedSwitchThumb = await page.locator('input[name="overrideclientsettings"]').evaluate((element) => {
    const style = window.getComputedStyle(element, '::after');
    const checkboxGlyph = window.getComputedStyle(element, '::before');
    return {
      content: style.content,
      width: style.width,
      height: style.height,
      background: style.backgroundColor,
      checkboxGlyphDisplay: checkboxGlyph.display
    };
  });
  expect(lockedSwitchThumb.content).not.toBe('none');
  expect(lockedSwitchThumb.width).toBe('18px');
  expect(lockedSwitchThumb.height).toBe('18px');
  expect(lockedSwitchThumb.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(lockedSwitchThumb.checkboxGlyphDisplay).toBe('none');
  const workflowModes = page.locator('input[name="weekly_mode"]');
  await expect(workflowModes).toHaveCount(3);
  expect(await workflowModes.evaluateAll((items) => items.every((item) => (item as HTMLInputElement).disabled))).toBe(true);
  const paperPolicies = page.locator('input[name="candidate_paper_submission_policy"]');
  await expect(paperPolicies).toHaveCount(3);
  expect(await paperPolicies.evaluateAll((items) => items.every((item) => !(item as HTMLInputElement).disabled))).toBe(true);
  await expect(page.locator('select[name="timesheet_break_entry_mode"]')).toBeDisabled();
  await page.locator('#btnCloseModal').click();
  await expect(page.locator('#modalTitle')).toContainText('Edit Contract');
  await expect(page.locator('#modalTabs')).toContainText('Rates');
  await expect(page.locator('#modalTabs')).toContainText('Additional Rates');

  await page.evaluate(async () => {
    const frame = (window as any).__getModalFrame?.();
    await Promise.resolve(frame?.setTab?.('rates'));
  });
  await expect(page.locator('#contractRatesTab')).toBeVisible();
  await expect(page.locator('#contractRatesTab .ctms-contract-lock-banner')).toContainText('Rates are protected');
  await expect(page.locator('#contractRatesTab input:enabled')).toHaveCount(0);
  await expect(page.locator('#contractRatesTab select:enabled')).toHaveCount(0);
  await expect(page.locator('#contractRatesTab button:enabled')).toHaveCount(0);

  await page.evaluate(async () => {
    const frame = (window as any).__getModalFrame?.();
    await Promise.resolve(frame?.setTab?.('extras'));
  });
  await expect(page.locator('#contractAdditionalRatesTab')).toBeVisible();
  await expect(page.locator('#contractAdditionalRatesTab .ctms-contract-lock-banner')).toContainText('Additional rates are protected');
  await expect(page.locator('#contractAdditionalRatesTab input:enabled')).toHaveCount(0);
  await expect(page.locator('#contractAdditionalRatesTab select:enabled')).toHaveCount(0);
  await expect(page.locator('#contractAdditionalRatesTab button:enabled')).toHaveCount(0);
}

async function assertViewportFit(page: Page, viewportWidth: number) {
  const values = await page.evaluate(() => {
    const modal = document.getElementById('modal');
    const box = modal?.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      modalLeft: box?.left ?? -999,
      modalRight: box?.right ?? 99999,
      modalWidth: box?.width ?? 0
    };
  });
  expect(values.documentOverflow).toBeLessThanOrEqual(1);
  expect(values.modalLeft).toBeGreaterThanOrEqual(-1);
  expect(values.modalRight).toBeLessThanOrEqual(viewportWidth + 1);
  expect(values.modalWidth).toBeGreaterThan(300);
}

async function saveShot(page: Page, name: string) {
  mkdirSync(artifactDir, { recursive: true });
  // Contract tab renders may schedule the branded busy overlay on a later
  // task. Require two separated hidden observations so a late data refresh
  // cannot be captured between them.
  const overlay = page.locator('#globalLoadingOverlay');
  await page.waitForTimeout(900);
  await expect(overlay).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(overlay).toBeHidden({ timeout: 10_000 });
  await page.locator('#modal').screenshot({ path: resolve(artifactDir, `${name}.png`) });
}

for (const device of devices) {
  test(`Contract workflow is polished and responsive on ${device.label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    const counts = await installLocalAssets(page);
    await openApp(page);
    await openMockContract(page, {}, 'view');

    await expect(page.locator('.ctms-readonly-setting__value')).toHaveText('Electronic');
    await expect(page.locator('.ctms-readonly-setting__source')).toHaveText('Client default');
    await assertViewportFit(page, device.width);
    await saveShot(page, `01-contract-main-${device.label}`);

    await page.locator('#contractFooterModify > summary').click();
    const modifyPanel = page.locator('.ctms-contract-footer-menu__panel');
    await expect(modifyPanel).toBeVisible();
    const modifyPanelBox = await modifyPanel.boundingBox();
    expect(modifyPanelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((modifyPanelBox?.x ?? device.width) + (modifyPanelBox?.width ?? 1)).toBeLessThanOrEqual(device.width + 1);
    await saveShot(page, `02-contract-modify-${device.label}`);
    await page.locator('#contractFooterModify > summary').click();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#modalTitle')).toContainText('Edit Contract');
    await expect(page.locator('#contractFooterModify')).toBeHidden();
    await expect(page.locator('#btnContractAddMissingWeeks')).toBeVisible();
    await expect(page.locator('#btnContractUnassignAll')).toBeVisible();
    await expect(page.getByText(/^Chosen:/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Contract settings', exact: true }).click();
    await expect(page.locator('#modalTitle')).toContainText('Contract settings');
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    const overrideSwitch = page.locator('input.ctms-switch-control[name="overrideclientsettings"]');
    await expect(overrideSwitch).toBeVisible();
    const overrideSwitchBox = await overrideSwitch.boundingBox();
    expect(overrideSwitchBox?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(overrideSwitchBox?.height ?? 0).toBeGreaterThanOrEqual(24);
    await saveShot(page, `03-contract-settings-off-${device.label}`);
    await page.locator('input[name="overrideclientsettings"]').check();
    await expect(page.locator('.ctms-contract-override-panel')).toBeVisible();
    await expect(page.locator('#btnResetContractOverrides')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
    await expect(page.locator('#btnCloseModal')).toHaveText('Discard');
    await assertViewportFit(page, device.width);
    await saveShot(page, `03-contract-settings-dirty-${device.label}`);

    await page.locator('#btnCloseModal').click();
    await expect(page.getByTestId('modal-title').getByText('Discard changes?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.locator('#modalTitle')).toContainText('Edit Contract');
    await expect(page.locator('#btnCloseModal')).toHaveText('Close');

    // A clean Edit closes back to the parent record's View state. The second
    // Close dismisses that View modal entirely.
    await page.locator('#btnCloseModal').click();
    await expect(page.locator('#modalTitle')).toContainText('View Contract');
    await page.locator('#btnCloseModal').click();
    await expect(page.locator('#modalBack')).toBeHidden();
    await openMockContract(page, {}, 'view');

    await page.locator('#contractFooterModify > summary').click();
    await page.getByRole('menuitem', { name: 'Extend to new contract', exact: true }).click();
    await expect(page.locator('#modalTitle')).toContainText('Extend to new contract');
    await expect(page.getByRole('heading', { name: 'Extend to new Contract' })).toBeVisible();
    await assertViewportFit(page, device.width);
    await saveShot(page, `04-contract-extend-${device.label}`);
    await page.locator('#btnCloseModal').click();
    await expect(page.locator('#modalTitle')).toContainText('View Contract');

    await page.locator('#contractFooterModify > summary').click();
    await page.getByRole('menuitem', { name: 'Duplicate contract', exact: true }).click();
    await expect(page.locator('#modalTitle')).toContainText('Duplicate Contract');
    await page.getByLabel('Search candidate name').fill('beg');
    await expect(page.getByRole('checkbox', { name: 'Assign Begum, Amira' })).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-duplicate-count]').fill('3');
    await page.locator('[data-duplicate-count]').blur();
    await page.getByRole('checkbox', { name: 'Assign Begum, Amira' }).check();
    await expect(page.locator('.ctms-contract-duplicate-slot')).toHaveCount(3);
    await expect(page.locator('.ctms-contract-duplicate-slot').first()).toContainText('Begum, Amira');
    await assertViewportFit(page, device.width);
    if (device.width <= 480) {
      const overflow = await page.locator('.ctms-contract-duplicate-table-wrap').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflowX: getComputedStyle(el).overflowX }));
      expect(overflow.scroll).toBeGreaterThan(overflow.client);
      expect(['auto', 'scroll']).toContain(overflow.overflowX);
    }
    await saveShot(page, `05-contract-duplicate-${device.label}`);

    expect(counts.index).toBeGreaterThan(0);
    expect(counts.main).toBeGreaterThan(0);
    expect(counts.css).toBeGreaterThan(0);
    expect(counts.authorisers).toBeGreaterThan(0);
  });
}

for (const device of [devices[0], devices[3]]) {
  test(`Protected Contract controls are genuinely non-editable on ${device.label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    await installLocalAssets(page);
    await openApp(page);
    await openMockContract(page, {
      start_date: '2026-01-05',
      end_date: '2026-12-27',
      overrideclientsettings: true,
      real_timesheets_count: 3,
      timesheets_count: 3,
      has_real_timesheets: true,
      has_timesheets: true
    }, 'edit');

    await expect(page.locator('#contractModalTitleLock')).toBeVisible();
    await expect(page.locator('.ctms-contract-main .ctms-contract-lock-banner')).toHaveCount(0);
    await saveShot(page, `06-contract-protected-main-${device.label}`);
    await assertProtectedContractControls(page);
    await assertViewportFit(page, device.width);
    await saveShot(page, `07-contract-protected-additional-rates-${device.label}`);
  });
}

for (const device of [devices[0], devices[3]]) {
  test(`Contract deletion uses the branded confirmation on ${device.label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    await installLocalAssets(page);

    let deleteRequests = 0;
    let nativeDialogOpened = false;
    page.on('dialog', async (dialog) => {
      nativeDialogOpened = true;
      await dialog.dismiss();
    });
    await page.route('**/api/contracts/a0000000-0000-4000-8000-000000000001', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deleteRequests += 1;
      return route.fulfill({ status: 200, json: { ok: true } });
    });

    await openApp(page);
    await openMockContract(page, { can_delete: true }, 'edit');

    await page.getByRole('button', { name: 'Delete Contract', exact: true }).click();
    await expect(page.getByTestId('modal-title').getByText('Delete Contract?', { exact: true })).toBeVisible();
    await expect(page.getByText('Permanently delete this Contract? This cannot be undone.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Contract', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep Contract', exact: true })).toBeVisible();
    await assertViewportFit(page, device.width);
    await saveShot(page, `08-contract-delete-confirm-${device.label}`);

    await page.getByRole('button', { name: 'Keep Contract', exact: true }).click();
    await expect(page.locator('#modalTitle')).toContainText('Edit Contract');
    expect(deleteRequests).toBe(0);

    await page.getByRole('button', { name: 'Delete Contract', exact: true }).click();
    await expect(page.getByTestId('modal-title').getByText('Delete Contract?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete Contract', exact: true }).click();
    await expect.poll(() => deleteRequests).toBe(1);
    await expect(page.locator('#modalBack')).toBeHidden();
    expect(nativeDialogOpened).toBe(false);
  });
}
