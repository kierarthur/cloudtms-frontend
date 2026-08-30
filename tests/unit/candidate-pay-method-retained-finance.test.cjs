const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `missing section start: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `missing section end: ${to}`);
  return source.slice(start, end);
}

test('pay-method preview validates the retained-finance-aware canonical union', () => {
  const preview = section(
    'async function fetchCandidatePayMethodChangePreview',
    'async function applyCandidatePayMethodChange'
  );

  assert.match(preview, /CANONICAL_TIMESHEETS_WITH_RETAINED_FINANCE_AUTHORITY/);
  assert.doesNotMatch(preview, /CANONICAL_CURRENT_TIMESHEETS/);
  assert.match(preview, /retained_finance_timesheet_ids/);
  assert.match(preview, /retained_finance_timesheet_count/);
  assert.match(preview, /\.\.\.retainedFinanceTimesheetIds/);
  assert.match(preview, /has_retained_finance_authority/);
});

test('committed pay-method proof preserves retained financial authority', () => {
  const apply = section(
    'async function applyCandidatePayMethodChange',
    'async function openCandidatePayMethodChangeModal'
  );

  assert.match(apply, /CANONICAL_TIMESHEETS_WITH_RETAINED_FINANCE_AUTHORITY/);
  assert.doesNotMatch(apply, /CANONICAL_CURRENT_TIMESHEETS/);
  assert.match(apply, /retained_finance_timesheet_ids/);
  assert.match(apply, /retained_finance_timesheet_count/);
  assert.match(apply, /\.\.\.retainedFinanceTimesheetIds/);
  assert.match(apply, /has_retained_finance_authority/);
});

test('confirmation explains retained financial authority without changing stored economics', () => {
  const modal = section(
    'async function openCandidatePayMethodChangeModal',
    'function focusContractsAfterBulkChange'
  );

  assert.match(modal, /retains frozen financial authority/);
  assert.match(modal, /Canonical retained-finance Timesheets/);
  assert.match(modal, /Exact retained-finance-aware canonical target IDs/);
  assert.match(modal, /Source Timesheets, Contract Weeks, rates and TSFIN rows will not be changed/);
  assert.match(modal, /showSave:\s*false/);
  assert.match(modal, /showApply:\s*true/);
  assert.match(modal, /primaryLabel:\s*'Confirm change'/);
});
