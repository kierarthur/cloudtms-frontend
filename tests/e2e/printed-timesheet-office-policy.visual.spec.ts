import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const origin = 'https://testmode.arthur-rai.co.uk';
const localIndex = readFileSync(resolve(root, 'index.html'), 'utf8');
const localMain = readFileSync(resolve(root, 'js/main.js'), 'utf8');
const localModalCss = readFileSync(resolve(root, 'css/modal-modernisation.css'), 'utf8');
const marker = `printed-timesheet-office:${createHash('sha256').update(localMain).digest('hex').slice(0, 12)}`;
const artifactDir = resolve(root, '.codex-tmp/printed-timesheet-office-policy');

test.use({
  serviceWorkers: 'block',
  storageState: process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json'
});

const devices = [
  { label: 'desktop', width: 1440, height: 960 },
  { label: 'phone', width: 390, height: 844 },
  { label: 'large-phone', width: 480, height: 1040 },
  { label: 'fold', width: 344, height: 882 },
  { label: 'ipad', width: 820, height: 1180 }
];

async function installLocalAssets(page: Page) {
  const counts = { index: 0, main: 0, css: 0 };
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      counts.index += 1;
      return route.fulfill({
        body: localIndex.replace('</head>', `<script>window.__PRINTED_TIMESHEET_LOCAL_PROOF=${JSON.stringify(marker)};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
    }
    if (url.pathname === '/js/main.js') {
      counts.main += 1;
      return route.fulfill({
        body: localMain,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
    }
    if (url.pathname === '/css/modal-modernisation.css') {
      counts.css += 1;
      return route.fulfill({
        body: localModalCss,
        contentType: 'text/css; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
    }
    if (['/js/record-modal-layout.js', '/css/record-modal-layout.css', '/js/modal-modernisation.js', '/js/import-review-v1.js'].includes(url.pathname)) {
      return route.fulfill({
        body: readFileSync(resolve(root, url.pathname.slice(1))),
        contentType: url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
    }
    return route.continue();
  });
  return counts;
}

async function openLocalApp(page: Page) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__PRINTED_TIMESHEET_LOCAL_PROOF)).toBe(marker);
}

async function assertModalFits(page: Page, viewportWidth: number) {
  const measurements = await page.evaluate(() => {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modalBody');
    const card = document.querySelector<HTMLElement>('.ctms-policy-card--paper');
    const box = modal?.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflow: body ? body.scrollWidth - body.clientWidth : 999,
      cardOverflow: card ? card.scrollWidth - card.clientWidth : 999,
      modalLeft: box?.left ?? -1,
      modalRight: box?.right ?? 99999
    };
  });
  expect(measurements.documentOverflow).toBeLessThanOrEqual(1);
  expect(measurements.bodyOverflow).toBeLessThanOrEqual(1);
  expect(measurements.cardOverflow).toBeLessThanOrEqual(1);
  expect(measurements.modalLeft).toBeGreaterThanOrEqual(-1);
  expect(measurements.modalRight).toBeLessThanOrEqual(viewportWidth + 1);
}

for (const device of devices) {
  test(`Client printed-timesheet control is polished and responsive on ${device.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    const counts = await installLocalAssets(page);
    await openLocalApp(page);

    await page.evaluate(async () => {
      const settings = {
        id: '73000000-0000-4000-8000-000000000001',
        updated_at: '2026-08-26T09:00:00.000Z',
        timezone_id: 'Europe/London',
        week_ending_weekday: 0,
        default_submission_mode: 'ELECTRONIC',
        candidate_paper_submission_enabled: false,
        weekly_mode: 'NONE'
      };
      (window as any).modalCtx = {
        entity: 'clients',
        mode: 'edit',
        data: { id: '73000000-0000-4000-8000-000000000002', name: 'Berkshire Healthcare' },
        formState: { main: {} },
        clientSettingsState: { ...settings },
        clientSettingsBaseline: { ...settings }
      };
      (window as any).showModal(
        'Edit Client',
        [{ key: 'settings', label: 'Client settings' }],
        () => '<div id="clientSettings"></div>',
        null,
        true,
        null,
        { kind: 'clients', frameEntity: 'clients', forceEdit: true, showSave: false }
      );
      await (window as any).renderClientSettingsUI(settings);
    });

    await expect(page.getByRole('heading', { name: 'Printed QR Timesheets' })).toBeVisible();
    await expect(page.locator('.ctms-policy-badge')).toHaveText('Not allowed');
    await expect(page.getByText('central printed-timesheet feature')).toHaveCount(0);
    const submissionOptions = await page.locator('select[name="default_submission_mode"] option').allTextContents();
    expect(submissionOptions.map((value) => value.trim())).toEqual(['Electronic', 'Manual']);

    await page.getByLabel('Allow candidates to use Printed QR Timesheets').check();
    await expect(page.locator('.ctms-policy-badge')).toHaveText('Allowed');
    expect(await page.evaluate(() => (window as any).modalCtx.clientSettingsState.candidate_paper_submission_enabled)).toBe(true);
    await assertModalFits(page, device.width);

    mkdirSync(artifactDir, { recursive: true });
    await page.locator('#modal').screenshot({ path: resolve(artifactDir, `client-printed-timesheets-${device.label}.png`) });
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.main).toBeGreaterThan(0);
    expect(counts.css).toBeGreaterThan(0);
  });

  test(`Contract printed-timesheet override is independent and responsive on ${device.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    await installLocalAssets(page);
    await openLocalApp(page);

    await page.evaluate(() => {
      (window as any).modalCtx = {
        entity: 'contracts',
        mode: 'edit',
        data: {
          id: '73000000-0000-4000-8000-000000000003',
          client_id: '73000000-0000-4000-8000-000000000002',
          updated_at: '2026-08-26T09:05:00.000Z',
          overrideclientsettings: false,
          candidate_paper_submission_enabled_override: null,
          default_submission_mode: null
        },
        formState: { __forId: '73000000-0000-4000-8000-000000000003', main: {}, pay: {} },
        client_settings_snapshot: {
          candidate_paper_submission_enabled: true,
          default_submission_mode: 'ELECTRONIC',
          weekly_mode: 'NONE'
        },
        client_settings_snapshot_client_id: '73000000-0000-4000-8000-000000000002'
      };
      (window as any).showModal(
        'Edit Contract',
        [{ key: 'main', label: 'Main' }],
        () => '<form id="contractForm"><input type="hidden" name="client_id" value="73000000-0000-4000-8000-000000000002"></form>',
        null,
        true,
        null,
        { kind: 'contracts', frameEntity: 'contracts', forceEdit: true, showSave: false }
      );
      (window as any).openContractSettingsModal();
    });

    await expect(page.locator('#modalTitle')).toHaveText('Contract settings');
    await expect(page.getByRole('heading', { name: 'Printed QR Timesheets' })).toBeVisible();
    await expect(page.locator('.ctms-policy-badge')).toHaveText('Allowed');
    await expect(page.locator('input[name="candidate_paper_submission_policy"][value="INHERIT"]')).toBeChecked();
    const printedPolicyRadios = page.locator('input[name="candidate_paper_submission_policy"]');
    await expect(printedPolicyRadios).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) await expect(printedPolicyRadios.nth(index)).toBeEnabled();
    await expect(page.locator('input[name="overrideclientsettings"]')).not.toBeChecked();
    await expect(page.locator('select[name="default_submission_mode"]')).toBeDisabled();
    const contractModes = await page.locator('select[name="default_submission_mode"] option').allTextContents();
    expect(contractModes.map((value) => value.trim())).toEqual(['Electronic', 'Manual']);

    await page.locator('input[name="candidate_paper_submission_policy"][value="BLOCK"]').check();
    await expect(page.locator('.ctms-policy-badge')).toHaveText('Not allowed');
    expect(await page.evaluate(() => (window as any).modalCtx.formState.main.candidate_paper_submission_enabled_override)).toBe('');
    await page.locator('input[name="candidate_paper_submission_policy"][value="ALLOW"]').check();
    expect(await page.evaluate(() => (window as any).modalCtx.formState.main.candidate_paper_submission_enabled_override)).toBe('on');
    await expect(page.locator('.ctms-policy-badge')).toHaveText('Allowed');

    await page.locator('input[name="overrideclientsettings"]').check();
    await expect(page.locator('select[name="default_submission_mode"]')).toBeEnabled();
    await page.locator('input[name="overrideclientsettings"]').uncheck();
    expect(await page.evaluate(() => (window as any).modalCtx.formState.main.overrideclientsettings)).toBe('');
    await expect(page.locator('input[name="overrideclientsettings"]')).not.toBeChecked();
    await expect(page.locator('select[name="default_submission_mode"]')).toBeDisabled();
    await expect(page.locator('input[name="candidate_paper_submission_policy"][value="ALLOW"]')).toBeChecked();
    await assertModalFits(page, device.width);

    mkdirSync(artifactDir, { recursive: true });
    await page.locator('#modal').screenshot({ path: resolve(artifactDir, `contract-printed-timesheets-${device.label}.png`) });
  });
}
