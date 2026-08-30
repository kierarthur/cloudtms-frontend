import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const testOrigin = 'https://testmode.arthur-rai.co.uk';
const localIndex = readFileSync(resolve(root, 'index.html'), 'utf8');
const localMain = readFileSync(resolve(root, 'js/main.js'), 'utf8');
const localModalCss = readFileSync(resolve(root, 'css/modal-modernisation.css'), 'utf8');
const mainHash = createHash('sha256').update(localMain).digest('hex');
const cssHash = createHash('sha256').update(localModalCss).digest('hex');
const artifactDir = resolve(root, '.codex-tmp/candidate-bookings');

test.use({
  serviceWorkers: 'block',
  storageState: process.env.E2E_STORAGE_STATE_PATH || 'tests/e2e/.auth/user.json'
});

async function installLocalAssets(page: Page) {
  const marker = `candidate-bookings:${mainHash.slice(0, 12)}:${cssHash.slice(0, 12)}`;
  const counts = { index: 0, main: 0, css: 0 };
  await page.route(`${testOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/index.html') {
      counts.index += 1;
      await route.fulfill({
        body: localIndex.replace('</head>', `<script>window.__CANDIDATE_BOOKINGS_LOCAL_PROOF=${JSON.stringify({ marker, mainHash, cssHash })};</script></head>`),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    if (url.pathname === '/js/main.js') {
      counts.main += 1;
      await route.fulfill({
        body: localMain,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    if (url.pathname === '/css/modal-modernisation.css') {
      counts.css += 1;
      await route.fulfill({
        body: localModalCss,
        contentType: 'text/css; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-codex-local-asset': marker }
      });
      return;
    }
    await route.continue();
  });
  return { marker, counts };
}

async function openKierArthurBookings(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__CANDIDATE_BOOKINGS_LOCAL_PROOF)).toEqual({
    marker: `candidate-bookings:${mainHash.slice(0, 12)}:${cssHash.slice(0, 12)}`,
    mainHash,
    cssHash
  });

  await page.locator('[data-nav="candidates"]').click();
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  const quickSearch = page.locator('#quickSearch');
  await expect(quickSearch).toBeVisible({ timeout: 30_000 });
  const row = page.locator('.summary-body[data-summary-section="candidates"] tr[data-id]')
    .filter({ has: page.locator('td').filter({ hasText: /^\s*Arthur\s*$/ }) })
    .filter({ has: page.locator('td').filter({ hasText: /^\s*Kier\s*$/ }) })
    .first();

  let found = false;
  for (const query of ['Kier Arthur', 'Kier', 'Arthur']) {
    await quickSearch.fill(query);
    await quickSearch.press('Enter');
    await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
    found = await row.isVisible().catch(() => false);
    if (found) break;
  }
  expect(found).toBe(true);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  await row.dblclick();
  await expect(page.locator('#modalTitle')).toContainText('Candidate', { timeout: 30_000 });
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });

  const bookingsTab = page.locator('#modalTabs button').filter({ hasText: 'Bookings' }).first();
  await expect(bookingsTab).toBeVisible();
  await bookingsTab.click();
  await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('.candidate-contracts-table')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.candidate-contract-row').first()).toBeVisible({ timeout: 30_000 });
  return page.locator('#candidateCalendarHolder');
}

const comparable = (value: string, type: 'text' | 'date') => {
  const text = value.trim();
  if (text === '' || text === '—') return null;
  if (type === 'date') {
    const uk = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!uk) throw new Error(`Unexpected booking date: ${text}`);
    return Number(`${uk[3]}${uk[2]}${uk[1]}`);
  }
  return text;
};

function expectSorted(values: string[], type: 'text' | 'date', direction: 'asc' | 'desc') {
  const populated = values.map((value) => comparable(value, type)).filter((value) => value != null);
  for (let index = 1; index < populated.length; index += 1) {
    const previous = populated[index - 1]!;
    const current = populated[index]!;
    const comparison = type === 'date'
      ? Number(previous) - Number(current)
      : String(previous).localeCompare(String(current), 'en-GB', { sensitivity: 'base', numeric: true });
    if (direction === 'asc') expect(comparison).toBeLessThanOrEqual(0);
    else expect(comparison).toBeGreaterThanOrEqual(0);
  }
}

test('Kier Arthur bookings are bounded and every heading sorts both directions', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const proof = await installLocalAssets(page);
  const holder = await openKierArthurBookings(page);

  const scroll = page.locator('.candidate-contracts-scroll');
  const metrics = await scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    rowCount: element.querySelectorAll('.candidate-contract-row').length
  }));
  expect(metrics.rowCount).toBeGreaterThan(5);
  expect(metrics.clientHeight).toBeLessThanOrEqual(351);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  await expect(page.locator('#__candCalScroll')).toBeVisible();
  expect(await page.locator('#__candCalScroll').evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(300);

  const columns = [
    { key: 'client', cell: 1, type: 'text' as const },
    { key: 'jobTitle', cell: 2, type: 'text' as const },
    { key: 'band', cell: 3, type: 'text' as const },
    { key: 'startDate', cell: 4, type: 'date' as const },
    { key: 'endDate', cell: 5, type: 'date' as const }
  ];

  for (const column of columns) {
    const button = page.locator(`.candidate-contract-sort[data-sort="${column.key}"]`);
    const heading = button.locator('xpath=..');
    await button.click();
    await expect(heading).toHaveAttribute('aria-sort', 'ascending');
    expectSorted(await page.locator(`.candidate-contract-row td:nth-child(${column.cell})`).allTextContents(), column.type, 'asc');

    await button.click();
    await expect(heading).toHaveAttribute('aria-sort', 'descending');
    expectSorted(await page.locator(`.candidate-contract-row td:nth-child(${column.cell})`).allTextContents(), column.type, 'desc');
  }

  await expect(page.getByRole('button', { name: 'Show only' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open', exact: true }).first()).toBeVisible();
  for (const status of [
    'Planned',
    'Needs Attention',
    'Awaiting Authorisation',
    'Authorised',
    'Invoiced',
    'Paid',
    'On Hold'
  ]) {
    await expect(holder.locator('.legend .chip').filter({ hasText: status })).toBeVisible();
  }
  await expect(holder.locator('.legend')).not.toContainText('Processed (not ready)');
  await expect(holder.locator('.legend')).not.toContainText('Ready');
  mkdirSync(artifactDir, { recursive: true });
  await page.locator('#modal').screenshot({ path: resolve(artifactDir, 'candidate-bookings-desktop.png') });
  expect(proof.counts.index).toBeGreaterThan(0);
  expect(proof.counts.main).toBeGreaterThan(0);
  expect(proof.counts.css).toBeGreaterThan(0);
});

for (const viewport of [
  { label: 'phone', width: 390, height: 844 },
  { label: 'large-phone', width: 430, height: 932 },
  { label: 'ipad', width: 820, height: 1180 }
]) {
  test(`Kier Arthur bookings remain usable on ${viewport.label}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installLocalAssets(page);
    await openKierArthurBookings(page);
    const modal = page.locator('#modal');
    const modalBox = await modal.boundingBox();
    if (!modalBox) throw new Error('Candidate modal was not measurable.');
    expect(modalBox.x).toBeGreaterThanOrEqual(0);
    expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(viewport.width + 1);

    const scroll = page.locator('.candidate-contracts-scroll');
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(page.locator('.candidate-contract-sort[data-sort="client"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show only' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open', exact: true }).first()).toBeVisible();
    mkdirSync(artifactDir, { recursive: true });
    await modal.screenshot({ path: resolve(artifactDir, `candidate-bookings-${viewport.label}.png`) });
  });
}
