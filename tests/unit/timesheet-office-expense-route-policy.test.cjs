const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const start = source.indexOf('function classifyTimesheetEditDomains(ctxInput)');
const end = source.indexOf('function normaliseTimesheetExpensesDraft', start);

assert.notEqual(start, -1, 'timesheet domain classifier must exist');
assert.notEqual(end, -1, 'timesheet domain classifier boundary must exist');

const context = {};
vm.runInNewContext(
  `${source.slice(start, end)}\nthis.classify = classifyTimesheetEditDomains;`,
  context,
  { filename: 'timesheet-office-expense-route-policy.js' }
);

const classify = context.classify;

function plannedWeek(submissionMode, extra = {}) {
  return classify({
    contract_week: {
      id: 'planned-week',
      submission_mode_snapshot: submissionMode,
      status: 'PLANNED',
      ...extra
    }
  });
}

function realTimesheet(submissionMode, extra = {}) {
  return classify({
    timesheet: {
      timesheet_id: 'timesheet',
      submission_mode: submissionMode,
      ...extra
    },
    tsfin: {
      id: 'financial-snapshot',
      timesheet_id: 'timesheet'
    }
  });
}

test('planned Electronic and QR expense values are Office read-only while evidence remains manageable', () => {
  for (const mode of ['ELECTRONIC', 'QR']) {
    const policy = plannedWeek(mode);
    assert.equal(policy.canOpenExpenses, true, `${mode} Expenses tab remains available`);
    assert.equal(policy.canEditExpenses, false, `${mode} expense values are read-only`);
    assert.equal(policy.expenseStorageTarget, 'CONTRACT_WEEK_DRAFT');
    assert.equal(policy.canManageExpenseEvidence, true, `${mode} expense evidence remains independently manageable`);
    assert.equal(policy.expenseEvidenceDisabledReason, null);
    assert.match(policy.expensesDisabledReason, /managed through MyTMS/i);
    assert.ok(policy.reasonCodes.includes('EXPENSES_QR_OR_ELECTRONIC'));
  }
});

test('real Electronic and QR expense values are Office read-only while evidence remains manageable', () => {
  const electronic = realTimesheet('ELECTRONIC');
  const qr = realTimesheet('QR', { qr_status: 'USED' });

  for (const policy of [electronic, qr]) {
    assert.equal(policy.canOpenExpenses, true);
    assert.equal(policy.canEditExpenses, false);
    assert.equal(policy.expenseStorageTarget, 'TSFIN');
    assert.equal(policy.canManageExpenseEvidence, true);
    assert.equal(policy.expenseEvidenceStorageTarget, 'TIMESHEET_EVIDENCE');
  }
});

test('Manual expense values and eligible expense evidence remain editable', () => {
  const planned = plannedWeek('MANUAL');
  const real = realTimesheet('MANUAL');

  for (const policy of [planned, real]) {
    assert.equal(policy.isManualRoute, true);
    assert.equal(policy.canEditExpenses, true);
    assert.equal(policy.canManageExpenseEvidence, true);
    assert.equal(policy.expensesDisabledReason, null);
  }
});

test('lifecycle locks still make expense evidence read-only independently of route', () => {
  const policy = realTimesheet('ELECTRONIC', { authorised_at_server: '2026-08-25T10:00:00Z' });
  assert.equal(policy.canEditExpenses, false);
  assert.equal(policy.canManageExpenseEvidence, false);
  assert.match(policy.expenseEvidenceDisabledReason, /authorised/i);
});

test('Office save rejects blocked expense-value changes before queuing either draft route', () => {
  const guardStart = source.indexOf('if (expensesChanged && !canEditExpensesForSave)');
  const plannedSave = source.indexOf('await saveContractWeekExpensesDraftOnly()', guardStart);
  const realSave = source.indexOf("invalidateTimesheetLifecycleTrustForSave('tsfin-expenses-save'", guardStart);

  assert.notEqual(guardStart, -1, 'Office save must enforce the route-aware expense edit policy');
  assert.ok(plannedSave > guardStart, 'planned-week expense persistence must be downstream of the guard');
  assert.ok(realSave > guardStart, 'real-timesheet expense persistence must be downstream of the guard');
  assert.match(
    source.slice(guardStart, plannedSave),
    /GE\(\);\s*return \{ ok: false \};/,
    'blocked Office expense changes must exit before persistence'
  );
});

test('Office expense-evidence handling remains a separate policy decision', () => {
  assert.match(source, /const canManageExpenseEvidenceForSave = !!\(policy && policy\.canManageExpenseEvidence === true\)/);
  assert.doesNotMatch(
    source.slice(source.indexOf('const canManageExpenseEvidenceForSave'), source.indexOf('const hoursScheduleDisabledReasonForSave')),
    /canEditExpensesForSave/,
    'evidence management must not inherit the expense-value edit gate'
  );
});
