import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const origin = 'https://testmode.arthur-rai.co.uk';
const localIndex = readFileSync(resolve(root, 'index.html'), 'utf8');
const localMain = readFileSync(resolve(root, 'js/main.js'), 'utf8');
const localModernisation = readFileSync(resolve(root, 'js/modal-modernisation.js'), 'utf8');
const localModalCss = readFileSync(resolve(root, 'css/modal-modernisation.css'), 'utf8');
const marker = `rate-presets:${createHash('sha256').update(localMain).digest('hex').slice(0, 12)}`;
const artifactDir = resolve(root, '.codex-tmp/rate-preset-audit');
const useLocalAssets = process.env.E2E_RATE_PRESET_LOCAL_ASSETS !== '0';

test.use({
  serviceWorkers: 'block',
  storageState: process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json'
});

const viewports = [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'ipad', width: 820, height: 1180 },
  { label: 'large-phone', width: 480, height: 1040 },
  { label: 'phone', width: 390, height: 844 }
];

const preset = {
  id: '71000000-0000-4000-8000-000000000001',
  name: 'CPN Standard 2026',
  scope: 'CLIENT',
  client_id: 'a0000000-0000-4000-8000-000000000003',
  client_name: 'Arthur Rai Medical Services',
  role: 'Community Psychiatric Nurse',
  band: 'Band 6',
  display_site: 'Ward C',
  enable_paye: true,
  enable_umbrella: true,
  bucket_labels_json: { day: 'Day', night: 'Night', sat: 'Sat', sun: 'Sun', bh: 'BH' },
  paye_day: 20,
  paye_night: 25,
  paye_sat: 25,
  paye_sun: 30,
  paye_bh: 30,
  umb_day: 21,
  umb_night: 26,
  umb_sat: 26,
  umb_sun: 31,
  umb_bh: 31,
  charge_day: 30,
  charge_night: 35,
  charge_sat: 35,
  charge_sun: 40,
  charge_bh: 40,
  mileage_pay_rate: 0.55,
  mileage_charge_rate: 0.65,
  std_schedule_json: {
    mon: { start: '09:00', end: '17:00', break_minutes: 30 }
  },
  updated_at: '2026-08-27T09:00:00.000Z'
};

async function installLocalAssets(page: Page) {
  if (!useLocalAssets) return;
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return route.fulfill({
        body: localIndex.replace('</head>', `<script>window.__RATE_PRESET_LOCAL_PROOF=${JSON.stringify(marker)};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
    }
    if (url.pathname === '/js/main.js') {
      return route.fulfill({ body: localMain, contentType: 'application/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/js/modal-modernisation.js') {
      return route.fulfill({ body: localModernisation, contentType: 'application/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/css/modal-modernisation.css') {
      return route.fulfill({ body: localModalCss, contentType: 'text/css; charset=utf-8', headers: { 'cache-control': 'no-store' } });
    }
    return route.continue();
  });
}

async function installPresetApi(page: Page, state: { failList: boolean; saved: Record<string, unknown>[] }) {
  await page.route('**/api/rates/presets**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts.length > 3 ? parts[3] : '';

    if (method === 'GET' && !id) {
      if (state.failList) return route.fulfill({ status: 503, body: 'Preset service unavailable' });
      return route.fulfill({ json: { rows: [preset] } });
    }
    if (method === 'GET' && id) return route.fulfill({ json: { preset } });
    if (method === 'POST' || method === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.saved.push(body);
      return route.fulfill({ json: { preset: { ...preset, ...body } } });
    }
    if (method === 'DELETE') return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 405, body: 'Method not allowed' });
  });
}

async function openApp(page: Page) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  if (useLocalAssets) {
    expect(await page.evaluate(() => (window as any).__RATE_PRESET_LOCAL_PROOF)).toBe(marker);
  }
}

async function openMockContractRates(page: Page) {
  await page.evaluate(() => {
    const contract = {
      id: 'a0000000-0000-4000-8000-000000000001',
      candidate_id: 'a0000000-0000-4000-8000-000000000002',
      candidate_display: 'Baljit Rai-Baptiste',
      client_id: 'a0000000-0000-4000-8000-000000000003',
      client_name: 'Arthur Rai Medical Services',
      role: 'Community Psychiatric Nurse',
      band: 'Band 6',
      start_date: '2026-09-07',
      end_date: '2026-11-29',
      pay_method_snapshot: 'PAYE',
      overrideclientsettings: false,
      real_timesheets_count: 0,
      protected_timesheet_count: 0,
      rates_json: {
        paye_day: 10, paye_night: 11, paye_sat: 12, paye_sun: 13, paye_bh: 14,
        charge_day: 15, charge_night: 16, charge_sat: 17, charge_sun: 18, charge_bh: 19
      }
    };
    (window as any).modalCtx = {
      entity: 'contracts', mode: 'edit', data: contract,
      formState: { __forId: contract.id, main: {}, pay: {} }
    };
    (window as any).showModal(
      'Edit Contract',
      [{ key: 'rates', label: 'Rates', title: 'Rates' }],
      () => (window as any).renderContractRatesTab((window as any).modalCtx),
      async () => true,
      true,
      null,
      { kind: 'contracts', frameEntity: 'contracts', forceEdit: true, primaryLabel: 'Save' }
    );
  });
  await expect(page.locator('#contractRatesTab')).toBeVisible();
}

async function assertModalFit(page: Page, width: number) {
  const result = await page.evaluate(() => {
    const box = document.getElementById('modal')?.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      left: box?.left ?? -100,
      right: box?.right ?? 100000,
      width: box?.width ?? 0
    };
  });
  expect(result.documentOverflow).toBeLessThanOrEqual(1);
  expect(result.left).toBeGreaterThanOrEqual(-1);
  expect(result.right).toBeLessThanOrEqual(width + 1);
  expect(result.width).toBeGreaterThan(300);
}

async function screenshot(page: Page, name: string) {
  mkdirSync(artifactDir, { recursive: true });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 20_000 });
  await page.locator('#modal').screenshot({ path: resolve(artifactDir, `${name}.png`) });
}

for (const viewport of viewports) {
  test(`Rate preset workflow is polished and accurate on ${viewport.label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const state = { failList: false, saved: [] as Record<string, unknown>[] };
    await installLocalAssets(page);
    await installPresetApi(page, state);
    await openApp(page);

    await openMockContractRates(page);
    await expect(page.getByRole('button', { name: 'Choose preset…', exact: true })).toBeVisible();
    await page.evaluate(() => {
      (window as any).openRatePresetPicker((selected: Record<string, unknown>) => {
        (window as any).applyRatePresetToContractForm(selected, 'PAYE');
        const frame = (window as any).__getModalFrame?.();
        const parent = Array.isArray((window as any).__modalStack)
          ? (window as any).__modalStack[(window as any).__modalStack.length - 2]
          : null;
        if (parent) {
          parent.isDirty = true;
          parent._updateButtons?.();
        } else if (frame) {
          frame.isDirty = true;
          frame._updateButtons?.();
        }
      }, {
        client_id: 'a0000000-0000-4000-8000-000000000003',
        start_date: '2026-09-07',
        defaultScope: 'CLIENT'
      });
    });
    await expect(page.getByRole('heading', { name: 'Choose a rate preset' })).toBeVisible();
    await expect(page.locator('#rp_table thead')).not.toContainText('Dates');
    await expect(page.locator('#rp_table')).toContainText('D: 20.00');
    await expect(page.locator('#rp_table')).toContainText('Pay 0.55 · Charge 0.65');
    await page.locator('#rp_table tbody tr[data-i]').click();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
    await assertModalFit(page, viewport.width);
    await screenshot(page, `01-picker-${viewport.label}`);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    const expectedRates: Record<string, string> = {
      paye_day: '20.00', paye_night: '25.00', paye_sat: '25.00', paye_sun: '30.00', paye_bh: '30.00',
      umb_day: '21.00', umb_night: '26.00', umb_sat: '26.00', umb_sun: '31.00', umb_bh: '31.00',
      charge_day: '30.00', charge_night: '35.00', charge_sat: '35.00', charge_sun: '40.00', charge_bh: '40.00',
      mileage_pay_rate: '0.55', mileage_charge_rate: '0.65'
    };
    for (const [field, value] of Object.entries(expectedRates)) {
      await expect(page.locator(`#contractRatesTab input[name="${field}"]`)).toHaveValue(value);
    }
    const staged = await page.evaluate(() => {
      const frames = Array.isArray((window as any).__modalStack) ? (window as any).__modalStack : [];
      const contract = frames.find((frame: any) => frame?.kind === 'contracts' || frame?.entity === 'contracts');
      const main = contract?._ctxRef?.formState?.main || {};
      const pay = contract?._ctxRef?.formState?.pay || {};
      return { main, pay };
    });
    expect(staged.main.role).toBe('Community Psychiatric Nurse');
    expect(staged.main.band).toBe('Band 6');
    expect(staged.main.display_site).toBe('Ward C');
    expect(staged.main.__bucket_labels).toEqual({ day: 'Day', night: 'Night', sat: 'Sat', sun: 'Sun', bh: 'BH' });
    expect(staged.main.__template).toEqual({ mon: { start: '09:00', end: '17:00', break_minutes: 30 } });
    for (const [field, value] of Object.entries(expectedRates).filter(([field]) => /^(paye_|umb_|charge_)/.test(field))) {
      expect(staged.pay[field]).toBe(value);
    }
    await expect(page.locator('#btnSave')).toBeEnabled();

    const unexpectedDialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      unexpectedDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.locator('#btnCloseModal').click();
    await expect(page.getByTestId('modal-title').getByText('Discard changes?', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
    expect(unexpectedDialogs).toEqual([]);
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
    await page.evaluate(() => (window as any).openPresetRatesManager());
    await expect(page.getByRole('heading', { name: 'Manage rate presets' })).toBeVisible();
    await expect(page.locator('#ratesPresetsTable')).toContainText('CPN Standard 2026');
    await expect(page.locator('#ratesPresetsTable')).toContainText(/27\/08\/2026, \d{2}:\d{2}:\d{2}/);
    await assertModalFit(page, viewport.width);
    await screenshot(page, `02-manager-${viewport.label}`);

    await page.locator('#btnRpNew').click();
    await expect(page.getByRole('heading', { name: 'Rate preset details' })).toBeVisible();
    await page.locator('#rp_form input[name="name"]').fill('Ward CPN 2026');
    await page.locator('#rp_form input[name="role"]').fill('CPN');
    await page.locator('#rp_form input[name="paye_day"]').fill('20');
    await page.locator('#rp_form input[name="paye_day"]').blur();
    await page.locator('#rp_form input[name="charge_day"]').fill('30');
    await page.locator('#rp_form input[name="charge_day"]').blur();
    await page.locator('#rp_form input[name="mileage_pay_rate"]').fill('30');
    await page.locator('#rp_form input[name="mileage_pay_rate"]').blur();
    await expect(page.locator('#rp_form input[name="paye_day"]')).toHaveValue('20.00');
    await expect(page.locator('#rp_form input[name="charge_day"]')).toHaveValue('30.00');
    await expect(page.locator('#rp_form input[name="mileage_pay_rate"]')).toHaveValue('30.00');
    await expect(page.locator('#rp_form input[name="mileage_charge_rate"]')).toHaveValue('30.00');
    await expect(page.locator('#btnSave')).toBeEnabled();
    await assertModalFit(page, viewport.width);
    await screenshot(page, `03-editor-${viewport.label}`);
    await page.locator('#btnSave').click();
    await expect.poll(() => state.saved.length).toBe(1);
    expect(state.saved[0].mileage_pay_rate).toBe(30);
    expect(state.saved[0].mileage_charge_rate).toBe(30);
    expect(state.saved[0].std_schedule_json).toBeNull();
  });
}

test('An existing rate preset reloads and saves every configured value consistently', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = { failList: false, saved: [] as Record<string, unknown>[] };
  await installLocalAssets(page);
  await installPresetApi(page, state);
  await openApp(page);

  await page.evaluate(() => (window as any).openPresetRatesManager());
  const presetRow = page.locator('#ratesPresetsTable tbody tr[data-id]').first();
  await expect(presetRow).toContainText('CPN Standard 2026');
  await presetRow.dblclick();
  await expect(page.getByRole('heading', { name: 'Rate preset details' })).toBeVisible();

  const expectedFields: Record<string, string> = {
    name: 'CPN Standard 2026',
    role: 'Community Psychiatric Nurse',
    band: 'Band 6',
    display_site: 'Ward C',
    bucket_day: 'Day', bucket_night: 'Night', bucket_sat: 'Sat', bucket_sun: 'Sun', bucket_bh: 'BH',
    paye_day: '20.00', paye_night: '25.00', paye_sat: '25.00', paye_sun: '30.00', paye_bh: '30.00',
    umb_day: '21.00', umb_night: '26.00', umb_sat: '26.00', umb_sun: '31.00', umb_bh: '31.00',
    charge_day: '30.00', charge_night: '35.00', charge_sat: '35.00', charge_sun: '40.00', charge_bh: '40.00',
    mileage_pay_rate: '0.55', mileage_charge_rate: '0.65',
    mon_start: '09:00', mon_end: '17:00', mon_break: '30'
  };
  for (const [field, value] of Object.entries(expectedFields)) {
    await expect(page.locator(`#rp_form [name="${field}"]`)).toHaveValue(value);
  }
  await expect(page.locator('#rp_rate_type')).toHaveValue('CLIENT');
  await expect(page.locator('#rp_pay_mode')).toHaveValue('BOTH');
  await expect(page.locator('#rp_use_schedule')).toBeChecked();

  await page.locator('#btnEditModal').click();
  await page.locator('#rp_form input[name="name"]').fill('CPN Standard 2026 updated');
  await expect(page.locator('#btnSave')).toBeEnabled();
  await page.locator('#btnSave').click();
  await expect.poll(() => state.saved.length).toBe(1);

  const saved = state.saved[0];
  expect(saved).toMatchObject({
    name: 'CPN Standard 2026 updated',
    scope: 'CLIENT',
    client_id: preset.client_id,
    role: preset.role,
    band: preset.band,
    display_site: preset.display_site,
    enable_paye: true,
    enable_umbrella: true,
    bucket_labels_json: preset.bucket_labels_json,
    mileage_pay_rate: preset.mileage_pay_rate,
    mileage_charge_rate: preset.mileage_charge_rate,
    std_schedule_json: preset.std_schedule_json
  });
  for (const field of [
    'paye_day', 'paye_night', 'paye_sat', 'paye_sun', 'paye_bh',
    'umb_day', 'umb_night', 'umb_sat', 'umb_sun', 'umb_bh',
    'charge_day', 'charge_night', 'charge_sat', 'charge_sun', 'charge_bh'
  ]) {
    expect(saved[field]).toBe((preset as any)[field]);
  }
});

test('Rate preset service failure is not misreported as an empty list', async ({ page }) => {
  const state = { failList: true, saved: [] as Record<string, unknown>[] };
  await installLocalAssets(page);
  await installPresetApi(page, state);
  await openApp(page);
  await page.evaluate(() => (window as any).openPresetRatesManager());
  await expect(page.getByText('Rate presets could not be loaded', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  state.failList = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#ratesPresetsTable')).toContainText('CPN Standard 2026');
});
