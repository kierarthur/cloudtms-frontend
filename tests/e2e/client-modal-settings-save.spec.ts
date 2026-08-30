import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

const CLIENT_ID = '70000000-0000-4000-8000-000000000001';

test('Client settings can be saved with blank contact details and remain dirty across tabs', async ({ page }) => {
  const localFiles = new Map([
    ['/index.html', resolve(__dirname, '../../index.html')],
    ['/js/main.js', resolve(__dirname, '../../js/main.js')]
  ]);
  const localMainHash = createHash('sha256').update(readFileSync(localFiles.get('/js/main.js')!)).digest('hex');
  const intercepted = new Set<string>();
  const putBodies: Array<Record<string, unknown>> = [];
  let nativeDialogCount = 0;

  page.on('dialog', async (dialog) => {
    nativeDialogCount += 1;
    await dialog.dismiss();
  });

  await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = localFiles.get(key);
    if (!file) return route.continue();
    intercepted.add(key);
    let body = readFileSync(file);
    if (key === '/index.html') {
      body = Buffer.from(body.toString('utf8').replace(
        '</head>',
        `<script>window.__CLIENT_SETTINGS_PATCHED_ASSET__=${JSON.stringify(localMainHash)};</script></head>`
      ));
    }
    return route.fulfill({
      status: 200,
      body,
      contentType: key.endsWith('.js') ? 'application/javascript' : 'text/html'
    });
  });

  await page.route(`**/api/clients/${CLIENT_ID}/delete-eligibility`, (route) => route.fulfill({
    json: { can_delete: false, reason: 'Fixture record' }
  }));
  await page.route(`**/api/clients/${CLIENT_ID}`, async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: {
        client: {
          id: CLIENT_ID,
          name: 'Contact-free settings fixture',
          primary_invoice_email: null,
          ts_queries_email: null,
          ap_phone: '020 7272 3070',
          contact_title: null,
          contact_known_as: null,
          contact_forename: null,
          contact_surname: null,
          contact_job_title: null,
          contact_tel: null,
          contact_mobile: null,
          contact_email: null,
          vat_chargeable: true,
          payment_terms_days: 30
        },
        client_settings: {
          timezone_id: 'Europe/London',
          day_start: '07:00', day_end: '19:00',
          night_start: '19:00', night_end: '07:00',
          sat_start: '00:00', sat_end: '00:00',
          sun_start: '00:00', sun_end: '00:00',
          bh_start: '00:00', bh_end: '00:00',
          week_ending_weekday: 0,
          default_submission_mode: 'ELECTRONIC',
          autoprocess_hr: true,
          requires_hr: true,
          no_timesheet_required: false
        },
        has_e_history: false
      } });
    }
    if (route.request().method() === 'PUT') {
      putBodies.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ json: {
        client: { id: CLIENT_ID, name: 'Contact-free settings fixture', primary_invoice_email: null }
      } });
    }
    return route.fulfill({ status: 405, json: { ok: false } });
  });

  await page.goto('/');
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  expect(intercepted.has('/index.html')).toBe(true);
  expect(intercepted.has('/js/main.js')).toBe(true);
  expect(await page.evaluate(() => (window as any).__CLIENT_SETTINGS_PATCHED_ASSET__)).toBe(localMainHash);

  await page.evaluate((id) => (window as any).openClient({ id }), CLIENT_ID);
  await expect(page.locator('#modalTitle')).toHaveText('View Client');
  await page.locator('#btnEditModal').click();
  await expect(page.locator('#modalTitle')).toHaveText('Edit Client');

  await page.getByRole('tab', { name: 'Client settings' }).click();
  const timezone = page.locator('#clientSettingsForm input[name="timezone_id"]');
  await timezone.fill('Etc/UTC');
  const queryEmail = page.locator('#clientSettingsForm input[name="ts_queries_email"]');
  await queryEmail.fill('kier@arthur-rai.co.uk');
  await expect(page.locator('#btnSave')).toBeVisible();
  await expect(page.locator('#btnSave')).toBeEnabled();

  await page.getByRole('tab', { name: 'Main' }).click();
  await expect(page.locator('#tab-main input[name="primary_invoice_email"]')).toHaveValue('');
  await expect(page.locator('#btnSave')).toBeVisible();
  await expect(page.locator('#btnSave')).toBeEnabled();
  await page.locator('#btnSave').click();

  await expect.poll(() => putBodies.length).toBe(2);
  expect(putBodies[0].primary_invoice_email).toBeUndefined();
  expect(putBodies[0].ts_queries_email).toBe('kier@arthur-rai.co.uk');
  expect(putBodies[1]).toHaveProperty('client_settings');
  expect((putBodies[1].client_settings as Record<string, unknown>).timezone_id).toBe('Etc/UTC');
  expect(nativeDialogCount).toBe(0);
});
