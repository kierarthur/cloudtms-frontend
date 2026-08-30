import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

const CLIENT_ID = '70000000-0000-4000-8000-000000000091';
const fixture = {
  ok: true,
  client_name: 'Berkshire Healthcare',
  settings_updated_at: '2026-08-26T01:15:00.000Z',
  policy: {
    approved_emails: ['finance@berkshire.nhs.uk', 'ward.manager@berkshire.nhs.uk'],
    approved_domains: ['berkshire.nhs.uk', 'nhs.net'],
    allow_free_business_email: true
  },
  approved_email_count: 2,
  approved_domain_count: 2,
  usable: true
};

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'large-phone', width: 480, height: 1040 },
  { name: 'ipad-landscape', width: 1180, height: 820 }
]) {
  test(`Client authoriser manager is stable and polished on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const root = resolve(__dirname, '../..');
    const localFiles = new Map([
      ['/index.html', resolve(root, 'index.html')],
      ['/js/main.js', resolve(root, 'js/main.js')],
      ['/js/manager-authorisers.js', resolve(root, 'js/manager-authorisers.js')],
      ['/css/manager-authorisers.css', resolve(root, 'css/manager-authorisers.css')]
    ]);
    const managerHash = createHash('sha256').update(readFileSync(localFiles.get('/js/manager-authorisers.js')!)).digest('hex');
    const intercepted = new Set<string>();
    const writes: Array<Record<string, unknown>> = [];
    let current = structuredClone(fixture);
    let nativeDialogCount = 0;

    page.on('dialog', async (dialog) => { nativeDialogCount += 1; await dialog.dismiss(); });
    await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
      const url = new URL(route.request().url());
      const key = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = localFiles.get(key);
      if (!file) return route.continue();
      intercepted.add(key);
      let body = readFileSync(file);
      if (key === '/index.html') body = Buffer.from(body.toString('utf8').replace('</head>', `<script>window.__MANAGER_AUTHORISER_ASSET__=${JSON.stringify(managerHash)};</script></head>`));
      return route.fulfill({ status: 200, body, contentType: key.endsWith('.js') ? 'application/javascript' : key.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.route(`**/api/clients/${CLIENT_ID}/manager-authorisers`, async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: current });
      if (route.request().method() === 'PUT') {
        const body = JSON.parse(route.request().postData() || '{}');
        writes.push(body);
        current = { ...current, settings_updated_at: '2026-08-26T01:16:00.000Z', policy: body.policy, approved_email_count: body.policy.approved_emails.length, approved_domain_count: body.policy.approved_domains.length };
        return route.fulfill({ json: current });
      }
      return route.fulfill({ status: 405, json: { ok: false } });
    });

    await page.goto('/');
    await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#globalLoadingOverlay')).not.toHaveAttribute('data-show', '1', { timeout: 30_000 });
    expect(await page.evaluate(() => (window as any).__MANAGER_AUTHORISER_ASSET__)).toBe(managerHash);
    for (const required of localFiles.keys()) expect(intercepted.has(required)).toBe(true);

    await page.evaluate((id) => {
      (window as any).modalCtx = { entity: 'clients', data: { id, name: 'Berkshire Healthcare' } };
      (window as any).showModal('View Client', [{ key: 'settings', label: 'Client settings' }], () => '<form id="clientSettingsForm" style="min-height:900px"><h2>Other Client settings</h2></form>', null, true, null, { kind: 'clients', frameEntity: 'clients', showSave: false });
    }, CLIENT_ID);
    await expect(page.getByRole('heading', { name: 'Timesheet authorisers' })).toBeVisible();
    await expect(page.getByText('Other permitted business emails allowed')).toBeVisible();
    const parentBefore = await page.locator('#modal').boundingBox();
    await page.locator('#modalBody').evaluate((node) => { node.scrollTop = 80; });

    await page.getByRole('button', { name: 'Manage authorisers' }).click();
    await expect(page.getByRole('heading', { name: 'Approved timesheet authorisers — Berkshire Healthcare' })).toBeVisible();
    await expect(page.locator('.ma-metric strong')).toHaveText(['2', '2', '4']);
    const clientOverflow = await page.evaluate(() => {
      const body = document.getElementById('modalBody');
      const manager = document.querySelector<HTMLElement>('.ma-modal');
      return {
        viewport: document.documentElement.scrollWidth - window.innerWidth,
        body: body ? body.scrollWidth - body.clientWidth : 1,
        manager: manager ? manager.scrollWidth - manager.clientWidth : 1
      };
    });
    expect(clientOverflow.viewport).toBeLessThanOrEqual(1);
    expect(clientOverflow.body).toBeLessThanOrEqual(1);
    expect(clientOverflow.manager).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`manager-authorisers-${viewport.name}.png`), fullPage: true });

    await page.getByLabel('Add email address').fill('Payroll@Berkshire.NHS.UK');
    await page.getByRole('button', { name: 'Add email address' }).click();
    await expect(page.locator('input[value="payroll@berkshire.nhs.uk"]')).toBeVisible();
    await page.getByLabel('Add domain').fill('@community.nhs.uk');
    await page.getByRole('button', { name: 'Add domain' }).click();
    await expect(page.locator('input[value="@community.nhs.uk"]')).toBeVisible();
    await page.getByRole('button', { name: 'Save authorisers' }).click();
    await expect(page.getByRole('heading', { name: 'Timesheet authorisers' })).toBeVisible();
    await expect.poll(() => writes.length).toBe(1);
    expect(Object.keys(writes[0]).sort()).toEqual(['expected_settings_updated_at', 'policy', 'request_key']);
    expect(Object.keys(writes[0].policy as object).sort()).toEqual(['allow_free_business_email', 'approved_domains', 'approved_emails']);
    expect(nativeDialogCount).toBe(0);
    const parentAfter = await page.locator('#modal').boundingBox();
    expect(parentAfter?.width).toBeCloseTo(parentBefore?.width || 0, 0);
    expect(parentAfter?.x).toBeCloseTo(parentBefore?.x || 0, 0);
    await expect.poll(() => page.locator('#modalBody').evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(70);

    await page.getByRole('button', { name: 'Manage authorisers' }).click();
    await expect(page.locator('input[value="payroll@berkshire.nhs.uk"]')).toBeVisible();
    await page.locator('input[value="payroll@berkshire.nhs.uk"]').fill('changed@berkshire.nhs.uk');
    await page.getByRole('button', { name: /Remove finance@berkshire\.nhs\.uk/ }).click();
    await expect(page.locator('#modalTitle')).toHaveText('Remove approved authoriser?');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('input[value="finance@berkshire.nhs.uk"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#modalTitle')).toHaveText('Discard authoriser changes?');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('heading', { name: 'Timesheet authorisers' })).toBeVisible();
    expect(nativeDialogCount).toBe(0);
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 }
]) {
  test(`Contract authoriser manager preserves its narrow boundary on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const root = resolve(__dirname, '../..');
    const localFiles = new Map([
      ['/index.html', resolve(root, 'index.html')],
      ['/js/main.js', resolve(root, 'js/main.js')],
      ['/js/manager-authorisers.js', resolve(root, 'js/manager-authorisers.js')],
      ['/css/manager-authorisers.css', resolve(root, 'css/manager-authorisers.css')]
    ]);
    const writes: Array<Record<string, unknown>> = [];
    const contractId = '70000000-0000-4000-8000-000000000092';
    const response = {
      ok: true,
      client_name: 'Berkshire Healthcare',
      contract_updated_at: '2026-08-26T01:20:00.000Z',
      client_policy: { approved_emails: ['client.manager@berkshire.nhs.uk'], approved_domains: ['berkshire.nhs.uk'], allow_free_business_email: true },
      contract_policy: { mode: 'EXTEND', approved_emails: ['contract.manager@partner.nhs.uk'], approved_domains: ['partner.nhs.uk'] },
      effective_policy: { source_mode: 'EXTEND', approved_emails: ['client.manager@berkshire.nhs.uk', 'contract.manager@partner.nhs.uk'], approved_domains: ['berkshire.nhs.uk', 'partner.nhs.uk'], allow_free_business_email: true },
      client_approved_count: 2,
      contract_approved_count: 2,
      effective_approved_count: 4
    };
    await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
      const url = new URL(route.request().url());
      const key = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = localFiles.get(key);
      if (!file) return route.continue();
      return route.fulfill({ status: 200, body: readFileSync(file), contentType: key.endsWith('.js') ? 'application/javascript' : key.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.route(`**/api/contracts/${contractId}/manager-authorisers`, async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: response });
      const body = JSON.parse(route.request().postData() || '{}'); writes.push(body);
      return route.fulfill({ json: { ...response, contract_updated_at: '2026-08-26T01:21:00.000Z', contract_policy: body.policy } });
    });
    await page.goto('/');
    await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#globalLoadingOverlay')).not.toHaveAttribute('data-show', '1', { timeout: 30_000 });
    await page.evaluate((id) => {
      (window as any).modalCtx = { entity: 'contracts', data: { id, name: 'RMN temporary staffing' } };
      (window as any).showModal('View Contract', [{ key: 'main', label: 'Main' }], () => '<form id="contractForm"><h2>Contract settings</h2></form>', null, true, null, { kind: 'contracts', frameEntity: 'contracts', showSave: false });
    }, contractId);
    await page.getByRole('button', { name: 'Manage authorisers' }).click();
    await expect(page.getByRole('heading', { name: 'Approved timesheet authorisers — Berkshire Healthcare · RMN temporary staffing' })).toBeVisible();
    await page.getByLabel('Use only this Contract’s approved authorisers').check();
    await expect(page.getByText('Client rules excluded')).toBeVisible();
    const contractOverflow = await page.evaluate(() => {
      const body = document.getElementById('modalBody');
      const manager = document.querySelector<HTMLElement>('.ma-modal');
      return {
        viewport: document.documentElement.scrollWidth - window.innerWidth,
        body: body ? body.scrollWidth - body.clientWidth : 1,
        manager: manager ? manager.scrollWidth - manager.clientWidth : 1
      };
    });
    expect(contractOverflow.viewport).toBeLessThanOrEqual(1);
    expect(contractOverflow.body).toBeLessThanOrEqual(1);
    expect(contractOverflow.manager).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`contract-manager-authorisers-${viewport.name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Save authorisers' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(Object.keys(writes[0]).sort()).toEqual(['expected_contract_updated_at', 'policy', 'request_key']);
    expect(writes[0]).not.toHaveProperty('overrideclientsettings');
    expect((writes[0].policy as Record<string, unknown>).mode).toBe('CONTRACT_ONLY');
  });
}
