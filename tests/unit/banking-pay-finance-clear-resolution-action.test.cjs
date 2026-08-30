const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const candidateId = '6e8493ae-c207-497e-8d83-0b518753f590';
const financeCaseId = '11111111-2222-4333-8444-555555555555';
const linkedTimesheetId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}

const actionSource = sliceBetween(
  "const FINANCE_CLEAR_RESOLUTION_FAMILIES =",
  'const getFinanceResolutionState ='
);
const actionApi = vm.runInNewContext(`(() => {
  const trimStr = (value) => String(value == null ? '' : value).trim();
  const upperTrim = (value) => trimStr(value).toUpperCase();
  const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  const getNestedLinePayload = (line) => isPlainObject(line?.line_json) ? line.line_json : {};
  const console = { warn() {} };
  ${actionSource}
  return { normalizeFinanceResolutionAction, getFinanceResolutionAction };
})()`, Object.create(null));

const taxableAction = (overrides = {}) => ({
  action: 'CLEAR_CASE_RESOLUTION',
  enabled: true,
  label: 'Cancel Resolved Pay Channel',
  candidate_id: candidateId,
  finance_case_id: financeCaseId,
  case_key: `finance:${financeCaseId}`,
  resolution_family: 'TAXABLE_CHANNEL_RESTRUCTURE',
  ...overrides
});

test('canonical taxable clear action is accepted without a timesheet owner', () => {
  const line = {
    candidate_id: candidateId,
    finance_case_id: financeCaseId,
    clear_case_resolution_action: taxableAction(),
    case_resolution_actions: { clear: taxableAction() }
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(actionApi.getFinanceResolutionAction(line))),
    taxableAction()
  );
});

test('finance action comparison is self-contained in the live Banking Pay scope', () => {
  assert.match(actionSource, /financeClearResolutionActionSignature/);
  assert.doesNotMatch(actionSource, /\bstableStringify\b/);
});

test('canonical NON_BUCKET owner keeps only its exact optional linked timesheet', () => {
  const action = taxableAction({
    label: 'Cancel Resolved Gross Total',
    resolution_family: 'NON_BUCKET',
    linked_timesheet_id: linkedTimesheetId
  });
  const actual = actionApi.getFinanceResolutionAction({
    candidate_id: candidateId,
    finance_case_id: financeCaseId,
    clear_case_resolution_action: action
  });
  assert.equal(actual.resolution_family, 'NON_BUCKET');
  assert.equal(actual.linked_timesheet_id, linkedTimesheetId);
});

test('financial cancellation fails closed on BUCKETED, identity drift, or ownership inference', () => {
  for (const action of [
    taxableAction({ resolution_family: 'BUCKETED' }),
    taxableAction({ case_key: 'finance:00000000-0000-4000-8000-000000000000' }),
    taxableAction({ timesheet_id: linkedTimesheetId }),
    taxableAction({ finance_case_id: '' }),
    { action: 'CLEAR_CASE_RESOLUTION', enabled: true, candidate_id: candidateId }
  ]) {
    assert.equal(actionApi.getFinanceResolutionAction({
      candidate_id: candidateId,
      finance_case_id: financeCaseId,
      clear_case_resolution_action: action
    }), null);
  }
});

test('conflicting canonical or legacy aliases fail closed', () => {
  assert.equal(actionApi.getFinanceResolutionAction({
    candidate_id: candidateId,
    finance_case_id: financeCaseId,
    clear_case_resolution_action: taxableAction(),
    case_resolution_actions: {
      clear: taxableAction({ resolution_family: 'NON_BUCKET', label: 'Cancel Resolved Gross Total' })
    }
  }), null);

  assert.equal(actionApi.getFinanceResolutionAction({
    candidate_id: candidateId,
    finance_case_id: financeCaseId,
    clear_case_resolution_action: taxableAction(),
    clear_resolution_action: taxableAction({ resolution_family: 'BUCKETED' })
  }), null);
});

test('renderer and dispatcher preserve the finance owner boundary', () => {
  const render = sliceBetween(
    'const isResolvedFinanceLine =',
    'const displayBlockedReasonText ='
  );
  const dispatch = sliceBetween(
    "if (a === 'banking:pay:componentClearResolution') {",
    "if (a === 'banking:pay:toggleExcludeTimesheet') {"
  );
  const delegatedHandler = sliceBetween(
    'function attachBankingModalDelegatedHandlers() {',
    "const getTopFrame = () => {"
  );

  assert.match(render, /getFinanceResolutionAction\(line\)/);
  assert.match(render, /Cancel the resolved \$\{decisionLabel\} decision/);
  assert.match(render, /Existing frozen Draft payment items will not be changed/);
  assert.doesNotMatch(render, /advance:/);
  assert.doesNotMatch(render, /\|\|\s*'BUCKETED'/);
  assert.match(dispatch, /FINANCE_CLEAR_RESOLUTION_FAMILIES\.has\(resolutionFamily\)/);
  assert.match(delegatedHandler, /const FINANCE_CLEAR_RESOLUTION_FAMILIES = new Set\(\['TAXABLE_CHANNEL_RESTRUCTURE', 'NON_BUCKET'\]\)/);
  assert.match(delegatedHandler, /const isFinanceClearUuid = \(value\) =>/);
  assert.match(dispatch, /caseKey !== `finance:\$\{financeCaseId\}`/);
  assert.match(dispatch, /resolutionFamily === 'TAXABLE_CHANNEL_RESTRUCTURE' && linkedTimesheetId/);
  assert.match(dispatch, /bankingPayWorkbenchSessionClearCaseResolution/);
});
