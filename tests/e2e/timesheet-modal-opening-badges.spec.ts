import { expect, test } from '@playwright/test';

const TIMESHEET_ID = '355efe72-f2ab-4a99-aa19-9a713bdbabba';
const WRONG_OPENING_BADGES = /\b(Unprocessed|Manual|Weekly)\b/i;

type BadgeSnapshot = {
  stage: string;
  route: string;
  hydration: null | {
    fastOpen: boolean;
    detailsLoading: boolean;
    detailsLoaded: boolean;
    detailsError: boolean;
  };
};

async function readStageRouteRows(page): Promise<BadgeSnapshot> {
  return page.evaluate(() => {
    const modal = document.querySelector('[data-testid="modal"]') || document.querySelector('#modal') || document;
    const visible = (el: Element | null) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const rowTextByLabel = (label: string) => {
      const labels = Array.from(modal.querySelectorAll('label')).filter(visible);
      const labelEl = labels.find(el => (el.textContent || '').trim().toLowerCase() === label.toLowerCase());
      if (!labelEl) return '';
      const row = labelEl.closest('.row') || labelEl.parentElement;
      return row ? (row.textContent || '').replace(/\s+/g, ' ').trim() : '';
    };
    const hydration = (window as any).modalCtx?.timesheetHydration;
    return {
      stage: rowTextByLabel('Stage'),
      route: rowTextByLabel('Route'),
      hydration: hydration ? {
        fastOpen: hydration.fastOpen === true,
        detailsLoading: hydration.detailsLoading === true,
        detailsLoaded: hydration.detailsLoaded === true,
        detailsError: !!hydration.detailsError
      } : null
    };
  });
}

test('Timesheet modal opening Stage/Route badges stay neutral while details are lazy-loading', async ({ page }) => {
  let delayedDetailsUrl = '';
  await page.route('**/*', async route => {
    const url = route.request().url();
    const shouldDelay = !delayedDetailsUrl &&
      url.includes('/api/') &&
      url.includes(TIMESHEET_ID) &&
      /workbench|details|timesheets/i.test(url);
    if (shouldDelay) {
      delayedDetailsUrl = url;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await route.continue();
  });

  await page.goto(`/?e2e=1&modal=timesheet&timesheetId=${encodeURIComponent(TIMESHEET_ID)}`);

  await expect(page.getByTestId('modal')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('modal-title')).toContainText(/Timesheet/i, { timeout: 30_000 });

  const preLoadSamples: BadgeSnapshot[] = [];
  for (let i = 0; i < 80; i += 1) {
    const snapshot = await readStageRouteRows(page);
    if (snapshot.hydration?.detailsLoaded) break;
    preLoadSamples.push(snapshot);
    await page.waitForTimeout(50);
  }

  expect(delayedDetailsUrl, 'canonical timesheet details request should have been delayed').toContain(TIMESHEET_ID);
  expect(preLoadSamples.length, 'should sample the modal before detailsLoaded=true').toBeGreaterThan(0);
  expect(
    preLoadSamples.filter(sample => WRONG_OPENING_BADGES.test(`${sample.stage} ${sample.route}`)),
    'pre-load Stage/Route rows must not show guessed/default/stale badges'
  ).toEqual([]);
  expect(
    preLoadSamples.some(sample => /Loading timesheet state|Loading…|^Stage\s*$|^Route\s*$/i.test(`${sample.stage} ${sample.route}`)),
    'pre-load Stage/Route rows should show neutral loading text or be suppressed'
  ).toBeTruthy();

  await expect.poll(async () => (await readStageRouteRows(page)).hydration?.detailsLoaded === true, {
    timeout: 30_000
  }).toBeTruthy();

  const finalSnapshot = await readStageRouteRows(page);
  expect(`${finalSnapshot.stage} ${finalSnapshot.route}`).not.toContain('Loading timesheet state');
  expect(finalSnapshot.stage).toMatch(/Stage\s+\S+/);
  expect(finalSnapshot.route).toMatch(/Route\s+\S+/);
});
