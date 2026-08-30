const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

const section = (startMarker, endMarker) => {
  const start = main.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return main.slice(start, end);
};

test('existing unassigned contracts still render the contract calendar feed', () => {
  const source = section('function renderContractCalendarTab', 'function isConsecutiveDailyRun');
  assert.match(source, /if \(!hasId && !candId\)/);
  assert.match(source, /await fetchAndRenderContractCalendar\(c\.id/);
  assert.match(source, /Not yet assigned to a candidate/);
  assert.doesNotMatch(source, /<Unassigned>/);
});

test('unassigned timesheets are read-only but retain guarded deletion', () => {
  const source = section('function getCanonicalTimesheetFooterState', 'function setFormReadOnly');
  assert.match(source, /relatedCandidate\.candidate_id/);
  assert.match(source, /relatedContract\.candidate_id/);
  assert.match(source, /const hasAssignedCandidate = !!assignedCandidateId/);
  assert.match(source, /const editReadOnly =[^;]*!hasAssignedCandidate/);
  assert.match(source, /'CANDIDATE_NOT_ASSIGNED'/);
  const deleteExpression = source.match(/const canonicalCanDelete = !!\(([\s\S]*?)\n  \);/);
  assert.ok(deleteExpression, 'missing canonical delete expression');
  assert.match(deleteExpression[1], /lifecycleAuthoritySatisfied/);
  assert.match(deleteExpression[1], /backendCanDelete === true/);
  assert.doesNotMatch(deleteExpression[1], /hasAssignedCandidate/);
  assert.match(source, /const plannedBackendCanDelete = !!\([\s\S]*!hasTs[\s\S]*!!contractWeekId/);
  assert.match(source, /isPlannedWeek && plannedContractWeekAuthorityComplete[\s\S]*plannedBackendCanDelete/);
});

test('unassigned overview removes candidate-dependent actions and uses friendly wording', () => {
  const source = section('function renderTimesheetOverviewTab', 'function renderTimesheetFinanceTab');
  assert.match(source, /Not yet assigned to a candidate/);
  assert.match(source, /if \(hasAssignedCandidate && isWeekly && weekId\)/);
  assert.match(source, /if \(hasAssignedCandidate && isDaily && tsId\)/);
  assert.match(source, /if \(hasAssignedCandidate && !isAdjustment && !sourceTimesheetActionsBlocked\)/);
});
