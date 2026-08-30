const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const window = {};
for (const file of ['candidate-office-ui-policy-v1.js', 'candidate-office-presenter-v1.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), { window, Intl, Date, Object, Set });
}
const presenter = window.CloudTMSCandidateOfficePresenter;
const action = (code, group = 'FINALISATION') => ({ code, group, enabled: true });
// Credential-free shape observed from the current TEST Daily Office projection.
const received = () => ({
  current_identity: { route_family: 'ELECTRONIC', record_role: 'HOURS_ONLY' },
  candidate_status: { code: 'RECEIVED', tone: 'warning', label: 'Received' },
  workflow: { state: 'RECEIVED', workflow_kind: 'DAILY', route: 'PHONE', approval_method: 'PHONE', is_current_action_workflow: true, historical: false },
  manager_approval: { method: 'PHONE', state: 'APPROVED' },
  paper_pack: { state: 'NOT_APPLICABLE' },
  available_actions: [action('RETRY_FINALISATION'), action('REJECT_CANDIDATE_SUBMISSION', 'REJECTION')],
  primary_action: action('RETRY_FINALISATION'),
  rejections: [], diagnostics: [], observed_at_utc: '2026-08-28T21:45:00Z'
});

test('a signed current Daily receipt is Candidate complete on summary and detail without claiming Office authorisation', () => {
  const projection = received();
  const before = structuredClone(projection);
  for (const surface of ['SIMPLE_TIMESHEET', 'BULK_PROCESS', 'BULK_AUTHORISE']) {
    const result = presenter.presentCandidateOfficeDetail(projection, { surface });
    assert.equal(result.status.code, 'CANDIDATE_SUBMISSION_COMPLETE');
    assert.equal(result.status.label, 'Candidate Submission Complete');
    assert.equal(result.status.tone, 'success');
    assert.equal(result.source_status_code, 'RECEIVED');
    assert.equal(result.manager.status_label, 'Manager Approved');
    assert.equal(result.actions.some(a => a.code === 'RETRY_FINALISATION'), false);
    assert.equal(result.primary_action, null);
    assert.equal(result.actions.some(a => a.code === 'REJECT_CANDIDATE_SUBMISSION'), true);
  }
  assert.equal(presenter.presentCandidateOfficeSummary(projection).status.code, 'CANDIDATE_SUBMISSION_COMPLETE');
  assert.deepEqual(projection, before, 'Presentation must not mutate server or financial truth');
});

for (const [label, mutate] of [
  ['weekly', p => { p.workflow.workflow_kind = 'CONTRACT'; }],
  ['PAPER return', p => { p.workflow.route = 'PAPER'; p.paper_pack.state = 'RETURN_RECEIVED'; }],
  ['QR route', p => { p.current_identity.route_family = 'QR'; }],
  ['not current', p => { p.workflow.is_current_action_workflow = false; }],
  ['historical', p => { p.workflow.historical = true; }],
  ['missing current flag', p => { delete p.workflow.is_current_action_workflow; }],
  ['missing history flag', p => { delete p.workflow.historical; }],
  ['pending manager', p => { p.manager_approval.state = 'PENDING'; }],
  ['refused manager', p => { p.manager_approval.state = 'REFUSED'; }],
  ['no manager', p => { p.manager_approval = null; }],
  ['EMAIL', p => { p.manager_approval.method = 'EMAIL'; }],
  ['no paper applicability proof', p => { p.paper_pack = {}; }],
  ['final document pending', p => { p.workflow.state = 'MANAGER_APPROVED_PENDING_FINAL_DOCUMENT'; }],
  ['ready to finalise', p => { p.workflow.state = 'READY_TO_FINALISE'; }]
]) {
  test(`${label} does not acquire the completed Daily receipt exception`, () => {
    const projection = received();
    mutate(projection);
    const result = presenter.presentCandidateOfficeDetail(projection);
    assert.notEqual(result.status?.code, 'CANDIDATE_SUBMISSION_COMPLETE');
    assert.equal(result.actions.some(a => a.code === 'RETRY_FINALISATION'), true);
  });
}

for (const state of ['CANCELLED', 'SUPERSEDED', 'EXPIRED', 'REJECTED', 'REFUSED']) {
  test(`${state} retains its existing lifecycle precedence`, () => {
    const projection = received();
    projection.workflow.state = state;
    assert.notEqual(presenter.presentCandidateOfficeSummary(projection).status.code, 'CANDIDATE_SUBMISSION_COMPLETE');
  });
}

for (const route of ['MANUAL', 'HEALTHROSTER', 'NHSP']) {
  test(`${route} never manufactures Candidate completion from manager or financial status`, () => {
    const projection = received();
    projection.current_identity.route_family = route;
    projection.candidate_status.code = 'AUTHORISED';
    assert.equal(presenter.presentCandidateOfficeSummary(projection).status, null);
  });
}

test('a received PAPER return without a retry continues to show finalising, not complete', () => {
  const projection = received();
  projection.workflow.workflow_kind = 'CONTRACT';
  projection.workflow.route = 'PAPER';
  projection.paper_pack.state = 'RETURN_RECEIVED';
  projection.available_actions = [];
  assert.equal(presenter.presentCandidateOfficeSummary(projection).status.code, 'FINALISING_SUBMISSION');
});

test('the changed presenter has a new cache identity in the deployed entry page', () => {
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /candidate-office-presenter-v1\.js\?v=20260828-daily-receipt/);
});
