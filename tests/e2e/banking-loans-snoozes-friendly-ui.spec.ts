import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'mobile', width: 412, height: 915 }
];

for (const viewport of VIEWPORTS) {
  test(`keeps the Loans / Snoozes modal user-friendly on ${viewport.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const localMainPath = resolve(__dirname, '../../js/main.js');
    const localMainSha256 = createHash('sha256').update(readFileSync(localMainPath)).digest('hex');
    const productionBackendRequests: string[] = [];
    const financeMutationRequests: string[] = [];
    let interceptedMainUrl = '';
    let servedMainSha256 = '';
    let mockedLoansRequestCount = 0;
    let mockedAuditRequestCount = 0;
    const loansRequestUrls: URL[] = [];

    const financeRowsAll: any[] = Array.from({ length: 45 }, (_, index) => {
      const caseTypes = ['PAYMENT_ADVANCE', 'OVERPAYMENT', 'MANUAL_DEBT_ADJUSTMENT', 'UNDERPAYMENT'];
      const caseType = caseTypes[index % caseTypes.length];
      const number = String(index + 1).padStart(2, '0');
      const created = new Date(Date.UTC(2026, 6, 18, 12, 0, 0) - index * 86_400_000).toISOString();
      return {
        finance_case_id: index === 0 ? 'codex-friendly-ui-case' : `codex-finance-case-${number}`,
        case_type: index === 0 ? 'OVERPAYMENT' : caseType,
        admin_label: index === 0
          ? 'Overpayment'
          : caseType.split('_').map((part) => part[0] + part.slice(1).toLowerCase()).join(' '),
        candidate_display_name: index === 0 ? 'Test Candidate' : `Candidate ${number}`,
        client_name: `Test Client ${number}`,
        status: 'ACTIVE',
        lifecycle_status_display: 'Active',
        created_at: created,
        created_at_utc: created,
        blocked_state: '',
        blocked_reason: '',
        original_amount: 125 + index,
        outstanding_amount: 75 + index,
        weekly_due: 25,
        start_week_start: '2026-07-13',
        next_due_week_start: '2026-07-20',
        open_taxable_count: 5,
        open_reimbursement_count: 0,
        unresolved_taxable_count: 0,
        stale_count: 0,
        is_mixed_case: false,
        component_resolution_summary_json: {
          stale_count: 0,
          is_mixed_case: false,
          open_taxable_count: 5,
          open_reimbursement_count: 0,
          unresolved_taxable_count: 0
        },
        adjustment_comment: '',
        snooze: null,
        action_flags: {}
      };
    }).concat([
      {
        finance_case_id: 'codex-written-off-advance',
        case_type: 'PAYMENT_ADVANCE',
        admin_label: 'Payment Advance',
        candidate_display_name: 'Written Off Advance',
        client_name: 'Test Client',
        status: 'WRITTEN_OFF',
        finance_status: 'WRITTEN_OFF',
        lifecycle_status_display: 'Written off',
        finance_lifecycle_status_display: 'Written off',
        created_at: '2026-01-03T10:00:00.000Z',
        created_at_utc: '2026-01-03T10:00:00.000Z',
        written_off_at_utc: '2026-07-19T01:10:21.000Z',
        write_off_reason: 'Approved write-off',
        original_amount: 100,
        outstanding_amount: 0,
        weekly_due: 0,
        action_flags: {}
      },
      {
        finance_case_id: 'codex-written-off-overpayment',
        case_type: 'OVERPAYMENT',
        admin_label: 'Overpayment',
        candidate_display_name: 'Written Off Overpayment',
        client_name: 'Test Client',
        status: 'WRITTEN_OFF',
        finance_status: 'WRITTEN_OFF',
        lifecycle_status_display: 'Written off',
        finance_lifecycle_status_display: 'Written off',
        created_at: '2026-01-02T10:00:00.000Z',
        created_at_utc: '2026-01-02T10:00:00.000Z',
        written_off_at_utc: '2026-07-19T01:10:21.000Z',
        write_off_reason: 'Approved write-off',
        original_amount: 100,
        outstanding_amount: 0,
        weekly_due: 0,
        action_flags: {}
      },
      {
        finance_case_id: 'codex-written-off-manual-debt',
        case_type: 'MANUAL_DEBT_ADJUSTMENT',
        admin_label: 'Manual Debt Adjustment',
        candidate_display_name: 'Written Off Manual Debt',
        client_name: 'Test Client',
        status: 'WRITTEN_OFF',
        finance_status: 'WRITTEN_OFF',
        lifecycle_status_display: 'Written off',
        finance_lifecycle_status_display: 'Written off',
        created_at: '2026-01-01T10:00:00.000Z',
        created_at_utc: '2026-01-01T10:00:00.000Z',
        written_off_at_utc: '2026-07-19T01:10:21.000Z',
        write_off_reason: 'Approved write-off',
        original_amount: 100,
        outstanding_amount: 0,
        weekly_due: 0,
        action_flags: {}
      }
    ]);

    const timesheetRowsAll: any[] = Array.from({ length: 25 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      const created = new Date(Date.UTC(2026, 6, 18, 11, 0, 0) - index * 3_600_000).toISOString();
      return {
        snooze_id: `codex-timesheet-snooze-${number}`,
        row_kind: 'WHOLE_TIMESHEET',
        lifecycle_state: 'ACTIVE',
        snooze_state: 'INDEFINITE_SNOOZE',
        candidate_display_name: `Snoozed Candidate ${number}`,
        client_name: `Snooze Client ${number}`,
        timesheet_id: `timesheet-${number}`,
        reference_number: `REF-${number}`,
        week_ending_date: '2026-07-19',
        snooze_until_date: null,
        created_at_utc: created,
        updated_at_utc: created,
        pay_amount_ex_vat: 100 + index,
        segment_count: 0,
        segment_rows: [],
        action_flags: {}
      };
    });

    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('https://cloudtms.kier-88a.workers.dev/')) {
        productionBackendRequests.push(url);
      }
      if (
        url.startsWith('https://test-cloudtms-backend.kier-88a.workers.dev/api/banking/finance/')
        && !['GET', 'HEAD'].includes(request.method())
      ) {
        financeMutationRequests.push(`${request.method()} ${new URL(url).pathname}`);
      }
    });

    await page.route('**/js/main.js', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'testmode.arthur-rai.co.uk' || url.pathname !== '/js/main.js') {
        await route.continue();
        return;
      }
      interceptedMainUrl = url.href;
      servedMainSha256 = localMainSha256;
      await route.fulfill({
        path: localMainPath,
        contentType: 'application/javascript; charset=utf-8',
        headers: {
          'cache-control': 'no-store',
          'x-codex-local-asset': 'banking-loans-snoozes-friendly-ui'
        }
      });
    });

    await page.route('**/api/banking/finance/loans-snoozes**', async (route) => {
      mockedLoansRequestCount += 1;
      const requestUrl = new URL(route.request().url());
      loansRequestUrls.push(requestUrl);
      const hideCompleted = requestUrl.searchParams.get('hide_completed_non_current_items') !== 'false';
      const caseType = String(requestUrl.searchParams.get('case_type') || '').toUpperCase();
      const viewMode = String(requestUrl.searchParams.get('view_mode') || '').toUpperCase();
      const financePage = Math.max(1, Number(requestUrl.searchParams.get('finance_page') || 1));
      const financePageSize = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('finance_page_size') || 10)));
      const timesheetPage = Math.max(1, Number(requestUrl.searchParams.get('timesheet_page') || 1));
      const timesheetPageSize = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('timesheet_page_size') || 10)));
      const financeSortKey = String(requestUrl.searchParams.get('finance_sort_key') || 'created_at');
      const financeSortDir = String(requestUrl.searchParams.get('finance_sort_dir') || 'desc') === 'asc' ? 'asc' : 'desc';
      const timesheetSortKey = String(requestUrl.searchParams.get('timesheet_sort_key') || 'created_at');
      const timesheetSortDir = String(requestUrl.searchParams.get('timesheet_sort_dir') || 'desc') === 'asc' ? 'asc' : 'desc';

      const financeFiltered = financeRowsAll
        .filter((row) => !hideCompleted || !row.written_off_at_utc)
        .filter((row) => !caseType || row.case_type === caseType)
        .filter((row) => {
          if (viewMode === 'HISTORY') return !!row.written_off_at_utc;
          if (viewMode === 'ACTIVE') return !row.written_off_at_utc;
          if (viewMode === 'SNOOZED') return false;
          return true;
        })
        .sort((left, right) => {
          const direction = financeSortDir === 'asc' ? 1 : -1;
          if (financeSortKey === 'candidate') {
            return direction * left.candidate_display_name.localeCompare(right.candidate_display_name);
          }
          if (financeSortKey === 'case_type') {
            return direction * left.admin_label.localeCompare(right.admin_label);
          }
          return direction * (new Date(left.created_at_utc).getTime() - new Date(right.created_at_utc).getTime());
        });

      const financeTotalPages = Math.max(1, Math.ceil(financeFiltered.length / financePageSize));
      const financeActualPage = Math.min(financePage, financeTotalPages);
      const financeStart = (financeActualPage - 1) * financePageSize;
      const financePageRows = financeFiltered.slice(financeStart, financeStart + financePageSize);

      const timesheetSorted = [...timesheetRowsAll].sort((left, right) => {
        const direction = timesheetSortDir === 'asc' ? 1 : -1;
        if (timesheetSortKey === 'candidate') {
          return direction * left.candidate_display_name.localeCompare(right.candidate_display_name);
        }
        if (timesheetSortKey === 'timesheet') {
          return direction * left.reference_number.localeCompare(right.reference_number);
        }
        return direction * (new Date(left.created_at_utc).getTime() - new Date(right.created_at_utc).getTime());
      });
      const timesheetTotalPages = Math.max(1, Math.ceil(timesheetSorted.length / timesheetPageSize));
      const timesheetActualPage = Math.min(timesheetPage, timesheetTotalPages);
      const timesheetStart = (timesheetActualPage - 1) * timesheetPageSize;
      const timesheetPageRows = timesheetSorted.slice(timesheetStart, timesheetStart + timesheetPageSize);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          filters: { hide_completed_non_current_items: hideCompleted },
          summary: {
            payment_advances_active_count: financeFiltered.filter((row) => row.case_type === 'PAYMENT_ADVANCE').length,
            overpayments_active_count: financeFiltered.filter((row) => row.case_type === 'OVERPAYMENT').length,
            underpayments_active_count: financeFiltered.filter((row) => row.case_type === 'UNDERPAYMENT').length,
            manual_debt_adjustments_active_count: financeFiltered.filter((row) => row.case_type === 'MANUAL_DEBT_ADJUSTMENT').length,
            manual_credit_adjustments_count: 0,
            mixed_finance_cases_count: 0,
            unresolved_finance_cases_count: 0,
            stale_finance_cases_count: 0,
            finance_cases_with_active_snooze_count: 0,
            timesheet_snoozes_count: timesheetRowsAll.length,
            timesheet_expense_snoozes_count: 0
          },
          finance_cases: financePageRows,
          timesheet_snoozes: timesheetPageRows,
          pagination: {
            finance_cases: {
              page: financeActualPage,
              page_size: financePageSize,
              total_count: financeFiltered.length,
              total_pages: financeTotalPages,
              sort_key: financeSortKey,
              sort_dir: financeSortDir
            },
            timesheet_snoozes: {
              page: timesheetActualPage,
              page_size: timesheetPageSize,
              total_count: timesheetRowsAll.length,
              total_pages: timesheetTotalPages,
              sort_key: timesheetSortKey,
              sort_dir: timesheetSortDir
            }
          }
        })
      });
    });

    await page.route('**/api/banking/finance/cases/codex-friendly-ui-case/audit', async (route) => {
      mockedAuditRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          finance_case: {
            finance_case_id: 'codex-friendly-ui-case',
            case_type: 'OVERPAYMENT',
            status: 'WRITTEN_OFF',
            candidate_display_name: 'Test Candidate',
            outstanding_amount: 0,
            weekly_due: 0
          },
          timeline: [
            {
              source: 'FINANCE_CASE_EVENT',
              event_type: 'WRITTEN_OFF',
              title: 'Written off',
              at_utc: '2026-07-19T01:10:21.000Z',
              actor_display_name: 'Kier Arthur',
              reason: 'Approved write-off'
            }
          ]
        })
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#globalLoadingOverlay')).toBeHidden({ timeout: 60_000 });
    expect(new URL(page.url()).hostname).toBe('testmode.arthur-rai.co.uk');
    expect(interceptedMainUrl).toBe('https://testmode.arthur-rai.co.uk/js/main.js');
    expect(servedMainSha256).toBe(localMainSha256);
    const browserMainSha256 = await page.evaluate(async () => {
      const response = await fetch('/js/main.js', { cache: 'no-store' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    });
    expect(browserMainSha256).toBe(localMainSha256);

    await page.getByRole('button', { name: 'Banking', exact: true }).click();
    const bankingModal = page.locator('#modal');
    await expect(bankingModal).toBeVisible({ timeout: 60_000 });
    await bankingModal.getByRole('button', { name: 'Loans / Snoozes', exact: true }).click();

    const financeCasesTable = bankingModal
      .locator('table.grid')
      .filter({ hasText: 'Recovery / Snooze / Comment' });
    await expect(financeCasesTable).toHaveCount(1);
    await expect(financeCasesTable).toBeVisible({ timeout: 60_000 });
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]')).toHaveCount(10);
    await expect(financeCasesTable).toContainText('Recovery: 5 taxable recovery items');
    await expect(financeCasesTable).toContainText('Comment: No comment');
    await expect(financeCasesTable).toContainText('Active');
    await expect(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Case Type' })).toBeVisible();
    await expect(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Candidate' })).toBeVisible();
    await expect(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Creation Date' })).toBeVisible();

    const timesheetSnoozesTable = bankingModal
      .locator('table.grid')
      .filter({ hasText: 'Snooze / Lifecycle' });
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]')).toHaveCount(10);
    await expect(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Candidate' })).toBeVisible();
    await expect(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Timesheet' })).toBeVisible();
    await expect(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Creation Date' })).toBeVisible();

    const financePagination = bankingModal.locator('[data-loans-snoozes-pagination="finance_cases"]');
    const timesheetPagination = bankingModal.locator('[data-loans-snoozes-pagination="timesheet_snoozes"]');
    const clickModalControl = async (control: ReturnType<typeof bankingModal.locator>) => {
      await control.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'center' });
        let ancestor = element.parentElement;
        while (ancestor) {
          const ancestorRect = ancestor.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          if (ancestor.scrollHeight > ancestor.clientHeight) {
            ancestor.scrollTop += elementRect.top - ancestorRect.top - Math.max(0, (ancestorRect.height - elementRect.height) / 2);
          }
          if (ancestor.scrollWidth > ancestor.clientWidth) {
            ancestor.scrollLeft += elementRect.left - ancestorRect.left - Math.max(0, (ancestorRect.width - elementRect.width) / 2);
          }
          ancestor = ancestor.parentElement;
        }
        element.scrollIntoView({ block: 'center', inline: 'center' });
      });
      await expect(control).toBeInViewport();
      await control.click();
    };
    const financePageSizeSelect = financePagination.getByRole('combobox', { name: 'Finance cases rows per page' });
    const timesheetPageSizeSelect = timesheetPagination.getByRole('combobox', { name: 'Timesheet snoozes rows per page' });
    await expect(financePageSizeSelect).toHaveValue('10');
    await expect(timesheetPageSizeSelect).toHaveValue('10');
    await expect(financePageSizeSelect.locator('option')).toHaveText(['5', '10', '20', '50']);
    await expect(timesheetPageSizeSelect.locator('option')).toHaveText(['5', '10', '20', '50']);
    await expect(financePagination).toContainText('Page 1 of 5');
    await expect(timesheetPagination).toContainText('Page 1 of 3');
    await expect(financePagination.getByRole('button', { name: 'Previous Finance cases page' })).toBeDisabled();
    await expect(timesheetPagination.getByRole('button', { name: 'Previous Timesheet snoozes page' })).toBeDisabled();

    await clickModalControl(financePagination.getByRole('button', { name: 'Next Finance cases page' }));
    await expect(financePagination).toContainText('Page 2 of 5');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]')).toHaveCount(10);
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Candidate 11');
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_page')).toBe('2');
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_page')).toBe('1');
    await clickModalControl(financePagination.getByRole('button', { name: 'Previous Finance cases page' }));
    await expect(financePagination).toContainText('Page 1 of 5');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Test Candidate');

    await clickModalControl(timesheetPagination.getByRole('button', { name: 'Next Timesheet snoozes page' }));
    await expect(timesheetPagination).toContainText('Page 2 of 3');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]')).toHaveCount(10);
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 11');
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_page')).toBe('1');
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_page')).toBe('2');
    await clickModalControl(timesheetPagination.getByRole('button', { name: 'Previous Timesheet snoozes page' }));
    await expect(timesheetPagination).toContainText('Page 1 of 3');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 01');

    await clickModalControl(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Candidate' }));
    await expect(financePagination).toContainText('Page 1 of 5');
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_key')).toBe('candidate');
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_dir')).toBe('asc');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Candidate 02');
    await clickModalControl(financePagination.getByRole('button', { name: 'Next Finance cases page' }));
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Candidate 12');

    await clickModalControl(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Candidate' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_dir')).toBe('desc');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Test Candidate');
    await clickModalControl(financePagination.getByRole('button', { name: 'Next Finance cases page' }));
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Candidate 36');

    await clickModalControl(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Case Type' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_key')).toBe('case_type');
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_dir')).toBe('asc');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Manual Debt Adjustment');
    await clickModalControl(financePagination.getByRole('button', { name: 'Next Finance cases page' }));
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Manual Debt Adjustment');
    await clickModalControl(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Case Type' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_dir')).toBe('desc');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Underpayment');
    await clickModalControl(financePagination.getByRole('button', { name: 'Next Finance cases page' }));
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Underpayment');

    await clickModalControl(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Creation Date' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_key')).toBe('created_at');
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_dir')).toBe('desc');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Test Candidate');
    await clickModalControl(financePagination.getByRole('button', { name: 'Next Finance cases page' }));
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Candidate 11');
    await clickModalControl(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Creation Date' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_dir')).toBe('asc');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Candidate 45');
    await clickModalControl(financePagination.getByRole('button', { name: 'Next Finance cases page' }));
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]').first()).toContainText('Candidate 35');

    await clickModalControl(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Candidate' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_key')).toBe('candidate');
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_dir')).toBe('asc');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 01');
    await clickModalControl(timesheetPagination.getByRole('button', { name: 'Next Timesheet snoozes page' }));
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 11');
    await clickModalControl(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Candidate' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_dir')).toBe('desc');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 25');
    await clickModalControl(timesheetPagination.getByRole('button', { name: 'Next Timesheet snoozes page' }));
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 15');

    await clickModalControl(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Timesheet' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_key')).toBe('timesheet');
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_dir')).toBe('asc');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('REF-01');
    await clickModalControl(timesheetPagination.getByRole('button', { name: 'Next Timesheet snoozes page' }));
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('REF-11');
    await clickModalControl(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Timesheet' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_dir')).toBe('desc');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('REF-25');

    await clickModalControl(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Creation Date' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_key')).toBe('created_at');
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_dir')).toBe('desc');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 01');
    await clickModalControl(timesheetPagination.getByRole('button', { name: 'Next Timesheet snoozes page' }));
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 11');
    await clickModalControl(timesheetSnoozesTable.getByRole('button', { name: 'Sort timesheet snoozes by Creation Date' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('timesheet_sort_dir')).toBe('asc');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 25');
    await clickModalControl(timesheetPagination.getByRole('button', { name: 'Next Timesheet snoozes page' }));
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]').first()).toContainText('Snoozed Candidate 15');

    await financePageSizeSelect.selectOption('5');
    await expect(financePageSizeSelect).toHaveValue('5');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]')).toHaveCount(5);
    await expect(timesheetPageSizeSelect).toHaveValue('10');
    await timesheetPageSizeSelect.selectOption('5');
    await expect(timesheetPageSizeSelect).toHaveValue('5');
    await expect(timesheetSnoozesTable.locator('[data-loans-snoozes-record="timesheet-snooze"]')).toHaveCount(5);

    const visibleModalText = await bankingModal.innerText();
    expect(visibleModalText).not.toMatch(/\b(?:stale_count|is_mixed_case|open_taxable_count|open_reimbursement_count|unresolved_taxable_count)\b/i);
    expect(visibleModalText).not.toContain('No component summary');
    expect(visibleModalText).not.toContain('Open taxable:');
    expect(visibleModalText).not.toContain('Source fingerprint:');
    expect(visibleModalText).not.toContain('Stable key:');
    expect(visibleModalText).not.toContain('Exact source:');
    expect(visibleModalText).not.toMatch(/\b(?:NOT_SNOOZED|INDEFINITE_SNOOZE|DATED_SNOOZE|SOURCE_REPLACED|SOURCE_CHANGED|SOURCE_UNAVAILABLE)\b/);

    const hideCompletedCheckbox = bankingModal.getByRole('checkbox', { name: 'Hide completed / non-current items' });
    const viewModeSelect = bankingModal.locator('select[data-action="banking:finance:setViewMode"]');
    await hideCompletedCheckbox.uncheck();
    await viewModeSelect.selectOption('HISTORY');
    await expect(financeCasesTable.locator('[data-loans-snoozes-record="finance-case"]')).toHaveCount(3);
    await expect(financeCasesTable).toContainText('Written Off Advance');
    await expect(financeCasesTable).toContainText('Written Off Overpayment');
    await expect(financeCasesTable).toContainText('Written Off Manual Debt');
    await expect(financeCasesTable).toContainText('Written off');
    await expect(financeCasesTable).not.toContainText('Paid off');

    await viewModeSelect.selectOption('');
    await hideCompletedCheckbox.check();
    await clickModalControl(financeCasesTable.getByRole('button', { name: 'Sort finance cases by Creation Date' }));
    expect(loansRequestUrls.at(-1)?.searchParams.get('finance_sort_dir')).toBe('desc');
    const specialFinanceRow = financeCasesTable
      .locator('[data-loans-snoozes-record="finance-case"]')
      .filter({ hasText: 'Test Candidate' });
    await clickModalControl(specialFinanceRow.getByRole('button', { name: 'Audit', exact: true }));
    const auditModal = page.getByRole('dialog', { name: 'Finance Case Audit' });
    await expect(auditModal).toBeVisible();
    await expect.poll(() => mockedAuditRequestCount, { timeout: 15_000 }).toBe(1);
    await expect(auditModal).toContainText('Written off');
    await expect(auditModal).toContainText('Kier Arthur');
    await expect(auditModal).toContainText('Approved write-off');
    await expect(auditModal).not.toContainText('Loading audit');

    expect(productionBackendRequests).toEqual([]);
    expect(financeMutationRequests).toEqual([]);
    expect(mockedLoansRequestCount).toBeGreaterThan(0);
    expect(mockedAuditRequestCount).toBe(1);
  });
}
