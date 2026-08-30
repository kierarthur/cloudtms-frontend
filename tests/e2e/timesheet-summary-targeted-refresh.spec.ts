import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.use({ storageState: { cookies: [], origins: [] } });

const root = path.join(__dirname, '..', '..');

function targetedRefreshManagerSource() {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const start = source.indexOf('function ensureTimesheetSummaryTargetedRefreshManager()');
  const end = source.indexOf('\nfunction renderSummary(rows)', start);
  if (start < 0 || end < 0) throw new Error('Targeted Summary refresh manager was not found.');
  return source.slice(start, end);
}

test('Candidate badge is immediate and heartbeat patches only the agreed Summary cells', async ({ page }) => {
  await page.setContent(`
    <div id="summary-body" style="height:120px;overflow:auto">
      <table style="height:400px"><tbody><tr id="summary-row" data-candidate-refresh-key="timesheet:00000000-0000-4000-8000-000000000001">
        <td data-col-key="candidate_name">Kier Arthur</td>
        <td data-col-key="processing_status">Processed</td>
        <td data-col-key="candidate_submission"></td>
        <td data-col-key="route_type">Weekly Electronic</td>
        <td data-col-key="submission_mode">Electronic</td>
        <td data-col-key="total_hours">8</td>
        <td data-col-key="total_pay_ex_vat">80.00</td>
        <td data-col-key="margin_ex_vat">120.00</td>
      </tr></tbody></table>
    </div>
  `);

  for (const file of [
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  ]) {
    await page.addScriptTag({ path: path.join(root, 'js', file) });
  }

  await page.addScriptTag({ content: `
    let currentSection = 'timesheets';
    window.__listState = { timesheets: { filters: {}, sort: {}, candidate_timesheet_summary_cursor: 1 } };
    window.__targetedCalls = [];
    window.__patchResponse = null;
    const API = path => path;
    const authFetch = async (url, options) => {
      window.__targetedCalls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, text: async () => JSON.stringify(window.__patchResponse) };
    };
    const formatDisplayValue = (_key, value) => value == null ? '' : value;
    const formatSummaryMoneyValue = value => Number(value).toFixed(2);
    const paintTimesheetProcessingStatusCell = (cell, _row, label) => { cell.textContent = label; };
    window.CloudTMSCandidateOfficeBridge = {
      mountSummaryBadge(cell, row) {
        const view = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(row.candidate_office_projection);
        cell.innerHTML = window.CloudTMSCandidateOfficeSurface.renderCandidateSummaryCell(view);
      }
    };
    ${targetedRefreshManagerSource()}
  ` });

  const initialProjection = {
    current_identity: { row_key: 'row-1', route_family: 'ELECTRONIC' },
    candidate_status: { code: 'FINALISED', label: 'raw', tone: 'danger' },
    workflow: { state: 'FINALISED', historical: true },
    manager_approval: null,
    paper_pack: { state: 'NOT_APPLICABLE' },
    rejections: [], diagnostics: [], primary_action: null, available_actions: []
  };

  await page.evaluate((projection) => {
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      timesheet_id: '00000000-0000-4000-8000-000000000001',
      contract_week_id: '00000000-0000-4000-8000-000000000101',
      processing_status: 'PROCESSED', processing_status_display: 'Processed',
      route_type: 'Weekly Electronic', submission_mode: 'Electronic',
      total_hours: 8, total_pay_ex_vat: 80, margin_ex_vat: 120,
      candidate_office_projection_loaded: true,
      candidate_office_projection: projection
    };
    const tr = document.querySelector('#summary-row');
    tr.__cloudtmsSummaryRow = row;
    window.CloudTMSCandidateOfficeBridge.mountSummaryBadge(
      tr.querySelector('[data-col-key="candidate_submission"]'), row
    );
    document.querySelector('#summary-body').scrollTop = 40;
    window.__testSummaryRow = row;
    window.__timesheetSummaryTargetedRefresh = null;
    ensureTimesheetSummaryTargetedRefreshManager().register({
      rows: [row],
      body: document.querySelector('#summary-body'),
      tbody: document.querySelector('tbody'),
      rowElements: new Map([['timesheet:00000000-0000-4000-8000-000000000001', tr]]),
      commitId: 7,
      cursor: 1,
      isCurrent: () => true
    });
  }, initialProjection);

  await expect(page.locator('[data-col-key="candidate_submission"]')).toHaveText('Candidate Submission Complete');
  expect(await page.locator('[data-col-key="candidate_submission"]').textContent()).not.toContain('unavailable');

  const unrelated = await page.evaluate(async () => (
    await window.__timesheetSummaryTargetedRefresh.consumeHeartbeat({
      candidate_timesheet_summary: {
        cursor: 2,
        changed_identities: [{ identity_kind: 'TIMESHEET', identity_id: '00000000-0000-4000-8000-000000000999' }],
        overflow: false
      }
    })
  ));
  expect(unrelated).toBe(false);
  expect(await page.evaluate(() => window.__targetedCalls.length)).toBe(0);

  const updatedProjection = {
    ...initialProjection,
    current_identity: { row_key: 'row-1', route_family: 'ELECTRONIC', row_signature: 'revision-2' },
    candidate_status: { code: 'AWAITING_MANAGER_APPROVAL', label: 'raw', tone: 'danger' },
    workflow: { state: 'AWAITING_MANAGER_APPROVAL' }
  };
  await page.evaluate(async (projection) => {
    window.__patchResponse = {
      patches: [{
        correlation_key: 'timesheet:00000000-0000-4000-8000-000000000001',
        found: true,
        patch: {
          id: '00000000-0000-4000-8000-000000000001',
          timesheet_id: '00000000-0000-4000-8000-000000000001',
          contract_week_id: '00000000-0000-4000-8000-000000000101',
          route_type: 'Daily Electronic', route_display: 'Daily Electronic', route_family: 'ELECTRONIC', sheet_scope: 'DAILY',
          submission_mode: 'Electronic', submission_mode_snapshot: 'Electronic',
          processing_status: 'AUTHORISED', processing_status_display: 'Authorised for Invoicing',
          total_hours: 12.5, total_pay_ex_vat: 437.5, margin_ex_vat: 371.87,
          current_identity: projection.current_identity,
          backend_row_signature: 'revision-2', row_signature: 'revision-2', expected_row_signature: 'revision-2',
          candidate_office_projection_loaded: true,
          candidate_office_projection_not_applicable: false,
          candidate_office_projection: projection,
          candidate_office_projection_error: null
        }
      }]
    };
    await window.__timesheetSummaryTargetedRefresh.consumeHeartbeat({
      candidate_timesheet_summary: {
        cursor: 3,
        changed_identities: [{
          identity_kind: 'TIMESHEET',
          identity_id: '00000000-0000-4000-8000-000000000001',
          current_timesheet_id: '00000000-0000-4000-8000-000000000001'
        }],
        overflow: false
      }
    });
  }, updatedProjection);

  await expect(page.locator('[data-col-key="candidate_submission"]')).toHaveText('Awaiting Manager Approval');
  await expect(page.locator('[data-col-key="processing_status"]')).toHaveText('Authorised for Invoicing');
  await expect(page.locator('[data-col-key="route_type"]')).toHaveText('Daily Electronic');
  await expect(page.locator('[data-col-key="submission_mode"]')).toHaveText('Electronic');
  await expect(page.locator('[data-col-key="total_hours"]')).toHaveText('12.5');
  await expect(page.locator('[data-col-key="total_pay_ex_vat"]')).toHaveText('437.50');
  await expect(page.locator('[data-col-key="margin_ex_vat"]')).toHaveText('371.87');
  await expect(page.locator('[data-col-key="candidate_name"]')).toHaveText('Kier Arthur');
  expect(await page.evaluate(() => document.querySelector('#summary-body').scrollTop)).toBe(40);

  const calls = await page.evaluate(() => window.__targetedCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('/api/timesheets/candidate-summary-patches');
  expect(calls[0].body.identities).toHaveLength(1);
  expect(JSON.stringify(calls)).not.toContain('/api/timesheets/summary');
  expect(JSON.stringify(calls)).not.toContain('totals');
});

test('overflow still sends one bounded request for all 200 loaded rows', async ({ page }) => {
  await page.setContent('<div id="body"><table><tbody></tbody></table></div>');
  await page.addScriptTag({ content: `
    let currentSection = 'timesheets';
    window.__listState = { timesheets: { filters: {}, sort: {}, candidate_timesheet_summary_cursor: 10 } };
    window.__targetedCalls = [];
    const API = path => path;
    const authFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      window.__targetedCalls.push({ url, body });
      return { ok: true, text: async () => JSON.stringify({ patches: body.identities.map(identity => ({ correlation_key: identity.row_key, found: false, patch: null })) }) };
    };
    const formatDisplayValue = (_key, value) => value;
    const formatSummaryMoneyValue = value => String(value);
    const paintTimesheetProcessingStatusCell = () => {};
    ${targetedRefreshManagerSource()}
  ` });
  const count = await page.evaluate(async () => {
    const rows = [];
    const rowElements = new Map();
    const tbody = document.querySelector('tbody');
    for (let index = 1; index <= 200; index += 1) {
      const suffix = String(index).padStart(12, '0');
      const id = '00000000-0000-4000-8000-' + suffix;
      const row = { id, timesheet_id: id };
      const tr = document.createElement('tr');
      tr.__cloudtmsSummaryRow = row;
      tbody.appendChild(tr);
      rows.push(row);
      rowElements.set('timesheet:' + id, tr);
    }
    window.__timesheetSummaryTargetedRefresh = null;
    ensureTimesheetSummaryTargetedRefreshManager().register({
      rows, body: document.querySelector('#body'), tbody, rowElements,
      commitId: 9, cursor: 10, isCurrent: () => true
    });
    await window.__timesheetSummaryTargetedRefresh.consumeHeartbeat({
      candidate_timesheet_summary: { cursor: 11, changed_identities: [], overflow: true }
    });
    return window.__targetedCalls[0].body.identities.length;
  });
  expect(count).toBe(200);
  expect(await page.evaluate(() => window.__targetedCalls.length)).toBe(1);
});
