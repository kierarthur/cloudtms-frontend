import { expect, test } from '@playwright/test';

test('Timesheet Expenses Travel value survives tab switching', async ({ page }) => {
  const timesheetId = process.env.E2E_TIMESHEET_ID;
  if (!timesheetId) {
    throw new Error('E2E_TIMESHEET_ID must be set to run the Timesheet modal e2e test.');
  }

  await page.goto(`/?e2e=1&modal=timesheet&timesheetId=${encodeURIComponent(timesheetId)}`);

  await expect(page.getByTestId('modal')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('modal-title')).toContainText(/Timesheet/i, { timeout: 30_000 });

  const expensesTab = page.getByTestId('timesheet-tab-expenses');
  await expect(expensesTab).toBeVisible({ timeout: 30_000 });
  await expect(expensesTab).not.toHaveAttribute('data-disabled', '1');

  const editButton = page.getByTestId('modal-edit');
  try {
    await expect(editButton).toBeVisible({ timeout: 10_000 });
    await editButton.click();
  } catch {
    // Some seeded test records may already open editable; the enabled input assertion below is authoritative.
  }

  await expensesTab.click();

  const travelPay = page.getByTestId('timesheet-expense-travel-pay');
  await expect(travelPay).toBeVisible({ timeout: 30_000 });
  await expect(travelPay).toBeEnabled();

  await travelPay.fill('12.34');
  await expect(travelPay).toHaveValue('12.34');

  await page.getByTestId('timesheet-tab-overview').click();
  await expect(page.getByTestId('timesheet-expense-travel-pay')).toHaveCount(0);

  await expensesTab.click();
  await expect(page.getByTestId('timesheet-expense-travel-pay')).toHaveValue('12.34');
});
