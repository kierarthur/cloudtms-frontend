const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
// main.js contains a compatibility-era renderer earlier in the bundle. The
// final declaration is the one JavaScript actually installs, so assertions
// must be anchored to that effective implementation.
const renderStart = source.lastIndexOf('function renderTimesheetEvidenceTab(ctx)');
const renderEnd = source.indexOf('async function openTimesheetEvidenceUploadDialog', renderStart);
const refreshStart = source.indexOf('async function refreshTimesheetEvidenceIntoModalState');
const refreshEnd = source.indexOf('async function', refreshStart + 30);

assert.ok(renderStart >= 0 && renderEnd > renderStart, 'Timesheet Evidence renderer must exist');
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'Timesheet Evidence refresh must exist');
const render = source.slice(renderStart, renderEnd);
const refresh = source.slice(refreshStart, refreshEnd);

test('withdrawn submissions are presented in a separate audit-only section', () => {
  assert.match(render, /Withdrawn submission history/);
  assert.match(render, /Previous submissions are retained for audit only\. They cannot be edited, restored, authorised or used for invoicing\./);
  assert.match(render, /data-withdrawn-submission-history="1"/);
  assert.match(render, /Read-only history/);
});

test('withdrawn files expose only view and download actions with phone-safe wrapping', () => {
  const historyStart = render.indexOf('const withdrawnHistoryHtml');
  const historyEnd = render.indexOf('const policyEvidenceReason', historyStart);
  assert.ok(historyStart >= 0 && historyEnd > historyStart, 'withdrawn history renderer must exist');
  const history = render.slice(historyStart, historyEnd);
  assert.match(history, /data-evidence-view=/);
  assert.match(history, /__tsEvidenceDownload/);
  assert.match(history, /overflow-wrap:anywhere/);
  assert.match(history, /min-height:44px/);
  assert.doesNotMatch(history, /data-evidence-(?:manage|return|remove|upload)/);
});

test('refresh stores history separately and hardens every item as read-only', () => {
  assert.match(refresh, /Array\.isArray\(json\.withdrawn_submissions\)/);
  assert.doesNotMatch(refresh, /!usePlannedWeekEndpoint[^\n]*Array\.isArray\(json\.withdrawn_submissions\)/);
  assert.match(refresh, /out\.withdrawn_history = true/);
  assert.match(refresh, /out\.can_delete = false/);
  assert.match(refresh, /out\.can_reclassify = false/);
  assert.match(refresh, /out\.can_return_to_queue = false/);
  assert.match(refresh, /targetState\.withdrawn_submissions = withdrawnCloned/);
  assert.match(refresh, /targetDetails\.withdrawn_submissions = withdrawnCloned/);
  assert.match(refresh, /targetData\.withdrawn_submissions = withdrawnCloned/);
});

test('viewer and downloader resolve both current and withdrawn evidence without merging their tables', () => {
  assert.match(source, /function getTimesheetEvidenceItemsFromModalContext/);
  assert.match(source, /const historical = withdrawn\.flatMap/);
  assert.match(source, /getTimesheetEvidenceItemsFromModalContext\(window\.modalCtx\)/);
  assert.match(source, /getTimesheetEvidenceItemsFromModalContext\(mc2\)/);
});

test('opening Issues hydrates cancellation history and rerenders the active tab', () => {
  assert.match(source, /case 'issues':[\s\S]*ensureTimesheetEvidenceLoaded\(openToken, \{ timesheetId: realIssuesTsId \}\)/);
  assert.match(source, /fr\.currentTabKey === 'evidence' \|\| fr\.currentTabKey === 'issues'/);
  assert.match(source, /fetchTimesheetEvidenceForFastOpen[\s\S]*withdrawn_submissions:/);
  assert.match(source, /mc\.timesheetDetails\.withdrawn_submissions = Array\.isArray/);
});

test('Issues presents the cancelling person, affected scope and mandatory reason', () => {
  const issuesStart = source.indexOf('function renderTimesheetIssuesTab(ctx)');
  const issuesEnd = source.indexOf('function buildOutboxFiltersFromUi', issuesStart);
  assert.ok(issuesStart >= 0 && issuesEnd > issuesStart, 'Timesheet Issues renderer must exist');
  const issues = source.slice(issuesStart, issuesEnd);
  assert.match(issues, /Cancelled submission history/);
  assert.match(issues, /withdrawn_by_display/);
  assert.match(issues, /withdrawal_scope/);
  assert.match(issues, /cancelled \$\{esc\(subject\)\}/);
  assert.match(issues, /<strong>Reason:<\/strong>/);
});

test('Issues presents manager refusal history and the exact manager reason', () => {
  const issuesStart = source.indexOf('function renderTimesheetIssuesTab(ctx)');
  const issuesEnd = source.indexOf('function buildOutboxFiltersFromUi', issuesStart);
  const issues = source.slice(issuesStart, issuesEnd);
  assert.match(issues, /Manager refusal history/);
  assert.match(issues, /manager_refusals/);
  assert.match(issues, /refusal_reason/);
  assert.match(issues, /refused_at_utc/);
  assert.match(issues, /manager_email/);
  assert.match(issues, /refused \$\{candidate/);
});

test('evidence hydration retains manager refusal history separately from evidence files', () => {
  assert.match(source, /fetchTimesheetEvidenceForFastOpen[\s\S]*manager_refusals:/);
  assert.match(source, /mc\.timesheetDetails\.manager_refusals = Array\.isArray/);
  assert.match(refresh, /Array\.isArray\(json\.manager_refusals\)/);
  assert.match(refresh, /targetState\.manager_refusals = managerRefusalsCloned/);
  assert.match(refresh, /targetDetails\.manager_refusals = managerRefusalsCloned/);
  assert.match(refresh, /targetData\.manager_refusals = managerRefusalsCloned/);
});
